import axios from 'axios'
import { createUsageLog } from '../../db/queries/usageLog'
import { calculateDeepSeekCost } from '../../config/planLimits'
import { logger } from '../../lib/logger'
import type {
  CallContext, ChatMessage, ChatOptions, LLMProvider, ProviderCapabilities,
} from './types'

// BASE_URL is environment-configurable so we can later point at our own
// hosted DeepSeek inference (vLLM on Yandex Cloud GPUs etc) without code
// changes. Defaults to the public API.
const DEFAULT_BASE_URL = 'https://api.deepseek.com'

// V4 migration (legacy deepseek-chat/deepseek-reasoner deprecate 2026-07-24).
// V4 is one model + a thinking toggle, not two model ids. We run tiered:
//   • FLASH (thinking off) for the bulk map/synthesis passes — same price as
//     the old deepseek-chat, stronger base model.
//   • PRO (thinking on, high effort) for reasoning-critical passes routed via
//     opts.reasoner — recomputation, calc grading, premise checks.
// Both ids are env-overridable so we can flip flash↔pro per tier, or point at
// self-hosted weights, without a redeploy.
const FLASH_MODEL = () => process.env.DEEPSEEK_MODEL_FLASH?.trim() || 'deepseek-v4-flash'
const PRO_MODEL   = () => process.env.DEEPSEEK_MODEL_PRO?.trim()   || 'deepseek-v4-pro'

const CAPABILITIES: ProviderCapabilities = {
  strictJsonMode:  true,
  reasonerMode:    true,
  maxOutputTokens: 8192,
}

export class DeepSeekProvider implements LLMProvider {
  name: 'deepseek' = 'deepseek'
  capabilities = CAPABILITIES

  private get baseUrl(): string {
    return process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL
  }

  private apiKey(): string {
    const key = process.env.DEEPSEEK_API_KEY
    if (!key) throw new Error('DEEPSEEK_API_KEY is not set')
    return key
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const start = Date.now()
    // Tiered routing: reasoner → PRO with thinking on; everything else → FLASH
    // with thinking off. Thinking is a body toggle in V4, not a separate model,
    // and it defaults to ENABLED — so we must set it explicitly on every call,
    // otherwise the bulk passes silently switch to slow/expensive reasoning.
    const thinking = !!opts.reasoner
    const model = thinking ? PRO_MODEL() : FLASH_MODEL()
    let errorCode: string | undefined

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model,
          messages,
          thinking: { type: thinking ? 'enabled' : 'disabled' },
          // High effort only matters when thinking is on; it's the lever that
          // drives the deep recomputation / premise-checking we want from PRO.
          ...(thinking ? { reasoning_effort: 'high' } : {}),
          // Thinking mode rejects response_format + sampling params (same
          // constraint family as the old reasoner). chatJSON's extractJSON +
          // retry covers the JSON path when thinking is on.
          ...(opts.jsonMode && !thinking ? { response_format: { type: 'json_object' } } : {}),
          ...(opts.temperature != null && !thinking ? { temperature: opts.temperature } : {}),
          ...(opts.maxTokens != null ? { max_tokens: opts.maxTokens } : {}),
        },
        {
          headers: {
            Authorization:  `Bearer ${this.apiKey()}`,
            'Content-Type': 'application/json',
          },
          timeout: thinking ? 110_000 : 60_000,
        }
      )

      const usage        = response.data.usage as { prompt_tokens: number; completion_tokens: number }
      const inputTokens  = usage?.prompt_tokens     ?? 0
      const outputTokens = usage?.completion_tokens ?? 0

      if (opts.context) {
        createUsageLog({
          ...opts.context,
          model:        `deepseek:${model}`,
          inputTokens,
          outputTokens,
          costUsd:      calculateDeepSeekCost(inputTokens, outputTokens, model),
          durationMs:   Date.now() - start,
          success:      true,
        }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
      }

      // In V4 thinking mode the chain-of-thought is in message.reasoning_content
      // (billed as output tokens); the actual answer stays in message.content.
      // We deliberately return only content — never the CoT.
      return response.data.choices[0].message.content as string

    } catch (err) {
      errorCode = axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN'

      if (opts.context) {
        createUsageLog({
          ...opts.context,
          model:        `deepseek:${model}`,
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

  async chatJSON<T>(
    messages:   ChatMessage[],
    retryLabel = 'response',
    opts:       ChatOptions = {},
  ): Promise<T> {
    const raw = await this.chat(messages, { ...opts, jsonMode: true })
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
      const retryRaw = await this.chat(retryMessages, { ...opts, jsonMode: true })
      return JSON.parse(extractJSON(retryRaw)) as T
    }
  }

  // Embeddings live on Yandex regardless of which chat provider is selected
  // (vector-space compatibility). DeepSeek's provider intentionally delegates
  // — implementing this method ourselves would let a misconfigured registry
  // accidentally land embedding calls here.
  async embed(text: string, ctx?: CallContext): Promise<number[]> {
    const { YandexProvider } = await import('./yandex')
    return new YandexProvider().embed(text, ctx)
  }
}

// Pull a JSON object out of a response that might be fenced or surrounded
// by prose (the reasoner has no strict mode and even chat-mode sometimes
// wraps its output).
function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const first = candidate.indexOf('{')
  const last  = candidate.lastIndexOf('}')
  return first !== -1 && last > first ? candidate.slice(first, last + 1) : candidate
}
