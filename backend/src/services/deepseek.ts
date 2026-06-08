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
  opts: { jsonMode?: boolean; context?: CallContext; model?: string } = {}
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

// ─── Embeddings ───────────────────────────────────────────────────────────────

// The embedding model has a token limit; cap very long inputs (e.g. a whole ВКР)
// to a safe prefix. The leading section is the most semantically representative
// for RAG retrieval, and this keeps the call from failing on huge documents.
const EMBED_MAX_CHARS = 24_000

export async function embed(text: string, context?: CallContext): Promise<number[]> {
  const start = Date.now()
  const input = text.length > EMBED_MAX_CHARS ? text.slice(0, EMBED_MAX_CHARS) : text
  try {
    const response = await axios.post(
      `${BASE_URL}/embeddings`,
      { model: 'deepseek-embedding', input },
      {
        headers: {
          Authorization:  `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        timeout: 30_000,
      }
    )

    if (context) {
      const usage = response.data.usage as { prompt_tokens: number; total_tokens: number } | undefined
      createUsageLog({
        ...context,
        model:        'deepseek-embedding',
        inputTokens:  usage?.prompt_tokens ?? 0,
        outputTokens: 0,
        costUsd:      0,   // embeddings cost is negligible at MVP scale
        durationMs:   Date.now() - start,
        success:      true,
      }).catch(() => null)
    }

    return response.data.data[0].embedding as number[]
  } catch (err) {
    if (context) {
      createUsageLog({
        ...context,
        model:        'deepseek-embedding',
        inputTokens:  0, outputTokens: 0, costUsd: 0,
        durationMs:   Date.now() - start,
        success:      false,
        errorCode:    axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN',
      }).catch(() => null)
    }
    throw err
  }
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
): Promise<T> {
  const raw = await chat(messages, { jsonMode: true, context, model })
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
    const retryRaw = await chat(retryMessages, { jsonMode: true, context, model })
    return JSON.parse(extractJSON(retryRaw)) as T
  }
}
