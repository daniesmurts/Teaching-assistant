import axios from 'axios'
import { createUsageLog } from '../../db/queries/usageLog'
import { calculateQwenCost } from '../../config/planLimits'
import { logger } from '../../lib/logger'
import type {
  CallContext, ChatMessage, ChatOptions, LLMProvider, ProviderCapabilities,
} from './types'

// Qwen3 provider. OpenAI-compatible chat/completions surface — works against
// DashScope's compatible-mode endpoint. Pinned to DashScope's proprietary
// hosted tiers (Plus/Max), not the open-weight qwen3-235b-a22b family — a
// deliberate quality-over-sovereignty choice made because this provider is
// reached only via explicit providerOverride today (cross-provider ensemble
// samples, cross-provider critique, blind numeric verification), never as an
// institution-facing "preferred_provider" (see institutionResolver.ts, which
// intentionally excludes 'qwen'). If Qwen ever becomes institution-selectable,
// the self-hosting/RU-residency question needs revisiting then — a
// hosted-only model can't be the answer to that.
//
// DashScope has two regional endpoints tied to where the account was
// created — mainland (dashscope.aliyuncs.com) and international
// (dashscope-intl.aliyuncs.com) — and a key issued for one 401s against the
// other. International is the default here since that's what our key
// resolves against; override QWEN_BASE_URL if a mainland-issued key is used.
const DEFAULT_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'

// Both Plus and Max honour `enable_thinking` as a runtime toggle on a single
// model id — verified against the live API (reasoning_content empty when
// off, populated when on) — same shape as DeepSeek V4's flash/pro split.
// (This differs from the older qwen3-235b-a22b open-weight release, which
// silently ignores the toggle and needs a separate -thinking- model id
// instead — don't assume this holds for future Qwen releases; re-verify
// live before switching.) Mirroring DeepSeek's own flash/pro cost tiering:
// FLASH stays on Plus for the cheap persona/temperature ensemble secondaries
// (the point there is model-family diversity, not maximum power); THINKING
// steps up to Max for opts.reasoner (calc verification, hard-math
// recomputation) — the case that actually benefits from the stronger tier.
// Rolling aliases (not dated snapshots) so DashScope's current-best model
// under each name is always used without a manual version bump.
const FLASH_MODEL    = () => process.env.QWEN_MODEL_FLASH?.trim()    || 'qwen3.7-plus'
const THINKING_MODEL = () => process.env.QWEN_MODEL_THINKING?.trim() || 'qwen3.7-max'

const CAPABILITIES: ProviderCapabilities = {
  strictJsonMode:  true,
  reasonerMode:    true,
  maxOutputTokens: 8192,
}

export class QwenProvider implements LLMProvider {
  name: 'qwen' = 'qwen'
  capabilities = CAPABILITIES

  private get baseUrl(): string {
    return process.env.QWEN_BASE_URL?.trim() || DEFAULT_BASE_URL
  }

  private apiKey(): string {
    const key = process.env.QWEN_API_KEY
    if (!key) throw new Error('QWEN_API_KEY is not set')
    return key
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const start = Date.now()
    const thinking = !!opts.reasoner
    const model = thinking ? THINKING_MODEL() : FLASH_MODEL()
    let errorCode: string | undefined

    try {
      const response = await axios.post(
        `${this.baseUrl}/chat/completions`,
        {
          model,
          messages,
          enable_thinking: thinking,
          chat_template_kwargs: { enable_thinking: thinking },
          ...(opts.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          // Thinking mode rejects sampling params on most Qwen3 deployments,
          // same constraint family as DeepSeek's reasoner.
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
        const costUsd = calculateQwenCost(inputTokens, outputTokens, model)
        createUsageLog({
          ...opts.context,
          model:        `qwen:${model}`,
          inputTokens,
          outputTokens,
          costUsd,
          costNative:   costUsd,
          currency:     'USD',
          durationMs:   Date.now() - start,
          success:      true,
        }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
      }

      // Thinking-mode chain-of-thought lands in message.reasoning_content on
      // most Qwen3-compatible servers — never returned, same policy as DeepSeek.
      return response.data.choices[0].message.content as string

    } catch (err) {
      errorCode = axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN'

      if (opts.context) {
        createUsageLog({
          ...opts.context,
          model:        `qwen:${model}`,
          inputTokens:  0, outputTokens: 0, costUsd: 0,
          currency:     'USD',
          durationMs:   Date.now() - start,
          success:      false,
          errorCode,
        }).catch(() => null)
        logger.warn({ message: 'Qwen call failed', feature: opts.context.feature, model, errorCode })
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

  // Embeddings always route through Yandex regardless of chat provider
  // (vector-space compatibility constraint) — same delegation as DeepSeek's.
  async embed(text: string, ctx?: CallContext): Promise<number[]> {
    const { YandexProvider } = await import('./yandex')
    return new YandexProvider().embed(text, ctx)
  }
}

function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const first = candidate.indexOf('{')
  const last  = candidate.lastIndexOf('}')
  return first !== -1 && last > first ? candidate.slice(first, last + 1) : candidate
}
