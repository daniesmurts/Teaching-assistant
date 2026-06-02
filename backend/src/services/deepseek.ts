import axios from 'axios'
import { createUsageLog } from '../db/queries/usageLog'
import { calculateDeepSeekCost } from '../config/planLimits'
import { logger } from '../lib/logger'

const BASE_URL = 'https://api.deepseek.com'
const MODEL    = 'deepseek-chat'

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
  opts: { jsonMode?: boolean; context?: CallContext } = {}
): Promise<string> {
  const start = Date.now()
  let success   = true
  let errorCode: string | undefined

  try {
    const response = await axios.post(
      `${BASE_URL}/chat/completions`,
      {
        model: MODEL,
        messages,
        ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
      {
        headers: {
          Authorization:  `Bearer ${apiKey()}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      }
    )

    const usage        = response.data.usage as { prompt_tokens: number; completion_tokens: number }
    const inputTokens  = usage?.prompt_tokens     ?? 0
    const outputTokens = usage?.completion_tokens ?? 0

    if (opts.context) {
      createUsageLog({
        ...opts.context,
        model:        MODEL,
        inputTokens,
        outputTokens,
        costUsd:      calculateDeepSeekCost(inputTokens, outputTokens),
        durationMs:   Date.now() - start,
        success:      true,
      }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
    }

    return response.data.choices[0].message.content as string

  } catch (err) {
    success   = false
    errorCode = axios.isAxiosError(err)
      ? `HTTP_${err.response?.status ?? 0}`
      : 'UNKNOWN'

    if (opts.context) {
      createUsageLog({
        ...opts.context,
        model:        MODEL,
        inputTokens:  0,
        outputTokens: 0,
        costUsd:      0,
        durationMs:   Date.now() - start,
        success:      false,
        errorCode,
      }).catch(() => null) // never let logging failure cascade

      logger.warn({ message: 'DeepSeek call failed', feature: opts.context.feature, errorCode })
    }

    throw err
  }
}

// ─── Embeddings ───────────────────────────────────────────────────────────────

export async function embed(text: string, context?: CallContext): Promise<number[]> {
  const start = Date.now()
  try {
    const response = await axios.post(
      `${BASE_URL}/embeddings`,
      { model: 'deepseek-embedding', input: text },
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

// ─── JSON parse with one retry ────────────────────────────────────────────────

export async function chatJSON<T>(
  messages: ChatMessage[],
  retryLabel = 'response',
  context?: CallContext
): Promise<T> {
  const raw = await chat(messages, { jsonMode: true, context })
  try {
    return JSON.parse(raw) as T
  } catch {
    const retryMessages: ChatMessage[] = [
      ...messages,
      { role: 'assistant', content: raw },
      {
        role:    'user',
        content: `Your ${retryLabel} was not valid JSON. Respond ONLY with a valid JSON object, no markdown, no explanation.`,
      },
    ]
    // Retry — log separately so we can see retry rate in admin
    const retryRaw = await chat(retryMessages, { jsonMode: true, context })
    return JSON.parse(retryRaw) as T
  }
}
