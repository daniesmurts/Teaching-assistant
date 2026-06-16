import axios from 'axios'
import { createUsageLog } from '../../db/queries/usageLog'
import { logger } from '../../lib/logger'
import type {
  CallContext, ChatMessage, ChatOptions, LLMProvider, ProviderCapabilities,
} from './types'

// Yandex Foundation Models. Embeddings already shipped (existing impl moved
// here verbatim — see EMBEDDINGS section). Chat is the new piece (filled in
// on day 3-4 of Phase 4). Stub raises until then so we don't accidentally
// route traffic before it's ready.

const CHAT_URL    = 'https://llm.api.cloud.yandex.net/foundationModels/v1/completion'
const EMBED_URL   = 'https://llm.api.cloud.yandex.net/foundationModels/v1/textEmbedding'
const CHAT_MODEL  = 'yandexgpt'        // alias for the institution's highest tier
const EMBED_MAX_CHARS = 6_000

const CAPABILITIES: ProviderCapabilities = {
  strictJsonMode:  false,     // no native JSON mode — we rely on parse-and-retry
  reasonerMode:    false,     // no dedicated reasoner
  maxOutputTokens: 8000,
}

export class YandexProvider implements LLMProvider {
  name: 'yandex' = 'yandex'
  capabilities = CAPABILITIES

  private apiKey(): string {
    const key = process.env.YANDEX_API_KEY || process.env.YANDEX_VISION_API_KEY
    if (!key) throw new Error('YANDEX_API_KEY (or YANDEX_VISION_API_KEY) is not set')
    return key
  }

  private folderId(): string {
    const id = process.env.YANDEX_FOLDER_ID
    if (!id) throw new Error('YANDEX_FOLDER_ID is not set')
    return id
  }

  // ─── chat ────────────────────────────────────────────────────────────────
  // Yandex completion endpoint. No native JSON mode — for chatJSON we tack a
  // strong instruction onto the system message and rely on the parse-and-retry
  // loop. Temperature and maxTokens map onto Yandex's `completionOptions`.
  // Reasoner mode is silently ignored (Yandex has no equivalent) and the
  // registry routes calc grading to DeepSeek anyway.

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const start = Date.now()
    const modelUri = `gpt://${this.folderId()}/${CHAT_MODEL}/latest`
    let errorCode: string | undefined

    try {
      const response = await axios.post(
        CHAT_URL,
        {
          modelUri,
          completionOptions: {
            stream:      false,
            temperature: opts.temperature ?? 0.6,   // Yandex requires temperature; sensible default
            maxTokens:   String(Math.min(opts.maxTokens ?? CAPABILITIES.maxOutputTokens, CAPABILITIES.maxOutputTokens)),
          },
          messages: messages.map((m) => ({
            role: m.role,
            text: m.content,
          })),
        },
        {
          headers: {
            Authorization:  `Api-Key ${this.apiKey()}`,
            'Content-Type': 'application/json',
          },
          timeout: 90_000,
        }
      )

      const alternative = response.data.result?.alternatives?.[0]
      const text = (alternative?.message?.text as string | undefined) ?? ''
      const usage = response.data.result?.usage as {
        inputTextTokens?:  string | number
        completionTokens?: string | number
      } | undefined

      const inputTokens  = Number(usage?.inputTextTokens ?? 0)
      const outputTokens = Number(usage?.completionTokens ?? 0)

      if (opts.context) {
        createUsageLog({
          ...opts.context,
          model:        `yandex:${CHAT_MODEL}`,
          inputTokens,
          outputTokens,
          costUsd:      0,   // priced in RUB by Yandex; cost tracking TBD in Phase 4 follow-up
          durationMs:   Date.now() - start,
          success:      true,
        }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
      }

      return text
    } catch (err) {
      errorCode = axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN'

      if (opts.context) {
        createUsageLog({
          ...opts.context,
          model:        `yandex:${CHAT_MODEL}`,
          inputTokens:  0, outputTokens: 0, costUsd: 0,
          durationMs:   Date.now() - start,
          success:      false,
          errorCode,
        }).catch(() => null)
        logger.warn({ message: 'Yandex chat call failed', feature: opts.context.feature, errorCode })
      }
      throw err
    }
  }

  // chatJSON for Yandex: prepend a strict "respond with valid JSON only"
  // instruction to the system message, call chat(), then parse-and-retry.
  // Identical retry strategy to DeepSeek but the upfront instruction matters
  // more since Yandex has no native response_format guarantee.
  async chatJSON<T>(
    messages:   ChatMessage[],
    retryLabel = 'response',
    opts:       ChatOptions = {},
  ): Promise<T> {
    const enforced = enforceJsonInstruction(messages)
    const raw = await this.chat(enforced, opts)
    try {
      return JSON.parse(extractJSON(raw)) as T
    } catch {
      const retryMessages: ChatMessage[] = [
        ...enforced,
        { role: 'assistant', content: raw },
        {
          role:    'user',
          content: `Ваш ${retryLabel} не был валидным JSON. Ответьте ТОЛЬКО валидным JSON-объектом, без markdown и пояснений.`,
        },
      ]
      const retryRaw = await this.chat(retryMessages, opts)
      return JSON.parse(extractJSON(retryRaw)) as T
    }
  }

  // ─── embed (existing impl, moved here verbatim) ──────────────────────────

  async embed(text: string, context?: CallContext): Promise<number[]> {
    const start = Date.now()
    const yandexKey = this.apiKey()
    const folder   = this.folderId()

    // Token cap varies with content; on HTTP 400 we halve and retry.
    let capChars = EMBED_MAX_CHARS
    let lastErr: unknown

    for (let attempt = 0; attempt < 3; attempt++) {
      const input = text.length > capChars ? text.slice(0, capChars) : text
      try {
        const response = await axios.post(
          EMBED_URL,
          {
            modelUri: `emb://${folder}/text-search-doc/latest`,
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
            model:        'yandex:text-search-doc',
            inputTokens:  Number(response.data.numTokens ?? 0),
            outputTokens: 0,
            costUsd:      0,
            durationMs:   Date.now() - start,
            success:      true,
          }).catch(() => null)
        }
        return vector
      } catch (err) {
        lastErr = err
        const status = axios.isAxiosError(err) ? err.response?.status : undefined
        if (status === 400 && input.length > 500) {
          capChars = Math.floor(input.length / 2)
          continue
        }
        break
      }
    }

    if (context) {
      createUsageLog({
        ...context,
        model:        'yandex:text-search-doc',
        inputTokens:  0, outputTokens: 0, costUsd: 0,
        durationMs:   Date.now() - start,
        success:      false,
        errorCode:    axios.isAxiosError(lastErr) ? `HTTP_${lastErr.response?.status ?? 0}` : 'UNKNOWN',
      }).catch(() => null)
      logger.warn({ message: 'Yandex embedding failed', feature: context.feature })
    }
    throw lastErr
  }

  // Internal — exposed for tests/eval to know which Yandex SKU was used.
  // The institution-tier setting picks the tier implicitly; v1 always uses
  // yandexgpt (the standard tier).
  static chatModelName(): string {
    return CHAT_MODEL
  }
}

// Without native JSON mode we lean on the system prompt. The instruction is
// prepended (or merged into an existing system message) so the model sees it
// before any user content.
function enforceJsonInstruction(messages: ChatMessage[]): ChatMessage[] {
  const PRE = 'Отвечайте СТРОГО валидным JSON-объектом, без markdown, fenced-блоков или сопроводительных пояснений.'
  const first = messages[0]
  if (first?.role === 'system') {
    return [
      { role: 'system', content: `${PRE}\n\n${first.content}` },
      ...messages.slice(1),
    ]
  }
  return [{ role: 'system', content: PRE }, ...messages]
}

// Same JSON extraction logic as DeepSeek's — pulls the object out of any
// fencing or surrounding prose.
function extractJSON(raw: string): string {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced ? fenced[1] : raw).trim()
  const first = candidate.indexOf('{')
  const last  = candidate.lastIndexOf('}')
  return first !== -1 && last > first ? candidate.slice(first, last + 1) : candidate
}
