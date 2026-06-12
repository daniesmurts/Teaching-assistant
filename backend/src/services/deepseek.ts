import axios from 'axios'
import { createUsageLog } from '../db/queries/usageLog'
import { calculateDeepSeekCost } from '../config/planLimits'
import { logger } from '../lib/logger'

const BASE_URL = 'https://api.deepseek.com'
const MODEL    = 'deepseek-chat'
export const REASONER_MODEL = 'deepseek-reasoner'   // R1 — step-by-step, far better at math/physics

function apiKey(): string {
  const key = process.env.DEEPSEEK_API_KEY
  if (!key) throw new Error('DEEPSEEK_API_KEY is not set')
  return key
}

// ─── Call context — threaded from services so every AI call is logged ─────────

export interface CallContext {
  teacherId:      string
  institutionId?: string
  feature:        'grading' | 'presentation' | 'feedback_email' | 'embedding'
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

// ─── Core chat completion ─────────────────────────────────────────────────────

export async function chat(
  messages: ChatMessage[],
  opts: { jsonMode?: boolean; context?: CallContext; model?: string; temperature?: number } = {}
): Promise<string> {
  const start = Date.now()
  const model = opts.model ?? MODEL
  const isReasoner = model === REASONER_MODEL
  let errorCode: string | undefined

  try {
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model,
        messages,
        // The reasoner (R1) does NOT support response_format — only the chat model gets JSON mode
        ...(opts.jsonMode && !isReasoner ? { response_format: { type: 'json_object' } } : {}),
        // Temperature drives ensemble sampling (confidence estimation). The
        // reasoner ignores temperature, so only pass it for the chat model.
        ...(opts.temperature != null && !isReasoner ? { temperature: opts.temperature } : {}),
      },
      {
        headers: {
          Authorization:  `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        timeout: isReasoner ? 110_000 : 60_000,   // reasoning is slower
      }
    )

    const usage        = response.data.usage as { prompt_tokens: number; completion_tokens: number }
    const inputTokens  = usage?.prompt_tokens     ?? 0
    const outputTokens = usage?.completion_tokens ?? 0

    if (opts.context) {
      createUsageLog({
        ...opts.context,
        model,
        inputTokens,
        outputTokens,
        costUsd:      calculateDeepSeekCost(inputTokens, outputTokens, model),
        durationMs:   Date.now() - start,
        success:      true,
      }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
    }

    // Reasoner returns the final answer in `content` (reasoning is in `reasoning_content`)
    return response.data.choices[0].message.content as string

  } catch (err) {
    errorCode = axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN'

    if (opts.context) {
      createUsageLog({
        ...opts.context,
        model,
        inputTokens:  0, outputTokens: 0, costUsd: 0,
        durationMs:   Date.now() - start,
        success:      false,
        errorCode,
      }).catch(() => null)
      logger.warn({ message: 'DeepSeek call failed', feature: opts.context.feature, model, errorCode })
    }
    throw err
  }
}

// ─── Embeddings (Yandex Foundation Models) ────────────────────────────────────
//
// DeepSeek's API has no embeddings endpoint — the original integration 404'd
// silently for the project's whole life (see migration 024). Embeddings now go
// through Yandex Foundation Models textEmbedding: 256-dim, Russia-accessible,
// same Api-Key auth scheme as Yandex Vision. The service account behind the
// key needs the ai.languageModels.user role.
//
// Yandex caps embedding input around 2k tokens — cap very long inputs (e.g. a
// whole ВКР) to a safe prefix; the lead section is the most semantically
// representative for retrieval anyway.
const EMBED_MAX_CHARS = 6_000
const YANDEX_EMBED_URL = 'https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding'

export async function embed(text: string, context?: CallContext): Promise<number[]> {
  const start = Date.now()

  const yandexKey = process.env.YANDEX_API_KEY || process.env.YANDEX_VISION_API_KEY
  const folderId  = process.env.YANDEX_FOLDER_ID
  if (!yandexKey || !folderId) {
    throw new Error('Yandex embeddings not configured (YANDEX_API_KEY / YANDEX_FOLDER_ID)')
  }

  // The model's hard cap is in tokens, but tokens-per-char varies wildly with
  // content (formula/digit-heavy STEM texts tokenize ~2× denser than prose).
  // Rather than guess, retry with a halved prefix when Yandex rejects the
  // input as too long (HTTP 400).
  let capChars = EMBED_MAX_CHARS
  let lastErr: unknown

  for (let attempt = 0; attempt < 3; attempt++) {
    const input = text.length > capChars ? text.slice(0, capChars) : text
    try {
      const response = await axios.post(
        YANDEX_EMBED_URL,
        {
          modelUri: `emb://${folderId}/text-search-doc/latest`,
          text:     input,
        },
        {
          headers: {
            Authorization:  `Api-Key ${yandexKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30_000,
        }
      )

      const vector = (response.data.embedding as number[] | undefined) ?? []
      if (vector.length === 0) throw new Error('Yandex embedding response missing vector')

      if (context) {
        createUsageLog({
          ...context,
          model:        'yandex-text-search-doc',
          inputTokens:  Number(response.data.numTokens ?? 0),
          outputTokens: 0,
          costUsd:      0,   // embeddings cost is negligible at MVP scale
          durationMs:   Date.now() - start,
          success:      true,
        }).catch(() => null)
      }

      return vector
    } catch (err) {
      lastErr = err
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      if (status === 400 && input.length > 500) {
        capChars = Math.floor(input.length / 2)   // too many tokens — halve and retry
        continue
      }
      break
    }
  }

  if (context) {
    createUsageLog({
      ...context,
      model:        'yandex-text-search-doc',
      inputTokens:  0, outputTokens: 0, costUsd: 0,
      durationMs:   Date.now() - start,
      success:      false,
      errorCode:    axios.isAxiosError(lastErr) ? `HTTP_${lastErr.response?.status ?? 0}` : 'UNKNOWN',
    }).catch(() => null)
  }
  throw lastErr
}

// Extract a JSON object from a model response that may wrap it in ```fences```
// or surrounding prose (the reasoner doesn't have a strict JSON mode).
function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const first = candidate.indexOf('{')
  const last  = candidate.lastIndexOf('}')
  return first !== -1 && last > first ? candidate.slice(first, last + 1) : candidate
}

// ─── JSON parse with one retry (works for both chat and reasoner models) ──────

export async function chatJSON<T>(
  messages: ChatMessage[],
  retryLabel = 'response',
  context?: CallContext,
  model?: string,
  temperature?: number,
): Promise<T> {
  const raw = await chat(messages, { jsonMode: true, context, model, temperature })
  try {
    return JSON.parse(extractJSON(raw)) as T
  } catch {
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role:    'user',
        content: `Ваш ${retryLabel} не был валидным JSON. Ответьте ТОЛЬКО валидным JSON-объектом, без markdown и пояснений.`,
      },
    ]
    const retryRaw = await chat(retryMessages, { jsonMode: true, context, model, temperature })
    return JSON.parse(extractJSON(retryRaw)) as T
  }
}
