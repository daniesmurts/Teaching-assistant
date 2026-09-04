import axios from 'axios'
import { createUsageLog } from '../../db/queries/usageLog'
import { calculateDeepSeekCost } from '../../config/planLimits'
import { logger } from '../../lib/logger'
import { sendTelegramAlert } from '../../lib/telegramAlert'
import type {
  CallContext, ChatMessage, ChatOptions, LLMProvider, ProviderCapabilities, VisionContentPart,
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

// Vision captioning (Feature AN Phase 2 follow-up, TODO.md "### AN").
// deepseek-v4-flash-vision-exp is DeepSeek's own "-exp" (experimental)
// endpoint — a separate model from FLASH, released 2026-08-21, billed at
// FLASH's per-token rate with images counted as up to 384 input tokens each
// (api-docs.deepseek.com/guides/vision). Gated behind an explicit env
// opt-in rather than auto-enabled like the rest of this codebase's
// best-effort calls: it costs real money per figure AND the vendor itself
// labels it experimental (shape/availability could change), so a deliberate
// per-environment switch beats a silent default-on.
const VISION_MODEL = () => process.env.DEEPSEEK_MODEL_VISION?.trim() || 'deepseek-v4-flash-vision-exp'
export function isVisionEnabled(): boolean {
  return process.env.DEEPSEEK_VISION_ENABLED === 'true'
}

const CAPABILITIES: ProviderCapabilities = {
  strictJsonMode:  true,
  reasonerMode:    true,
  maxOutputTokens: 8192,
}

// ─── Multi-account redundancy (2026-07-24) ─────────────────────────────────
//
// Incident: a single DeepSeek account ran out of balance (HTTP 402), and
// because that account was the platform's only credential, every
// LLM-dependent feature silently degraded until the balance was topped up.
// The account, its key, and its billing are all separate from any other
// DeepSeek-compatible account we hold (e.g. one via Alibaba Cloud's
// DashScope compatible-mode endpoint) — a payment failure on one has no
// bearing on the others, so trying the next account on a retryable failure
// is a real mitigation, not just redundant load.
//
// Account 1 is always the existing DEEPSEEK_API_KEY/DEEPSEEK_BASE_URL pair —
// zero config changes needed for the common single-account case. Additional
// accounts are DEEPSEEK_API_KEY_2..DEEPSEEK_API_KEY_5, each with an optional
// _BASE_URL_N (different providers host at different endpoints — Alibaba's
// compatible-mode endpoint is not api.deepseek.com) and _ACCOUNT_NAME_N (a
// human label for logs/alerts, e.g. "alibaba"; defaults to "key-N").
const MAX_ACCOUNTS = 5

// A retryable failure is one where the exact same request against a
// DIFFERENT account could plausibly succeed: the account itself is the
// problem (unauthorized, unfunded, rate-limited), or the call never got a
// response at all (network/timeout), or the provider had a transient outage
// (5xx). A 400/404/422 means the REQUEST is malformed — retrying it against
// another account fails identically, so we fail fast instead of burning
// through every account on a doomed call.
const RETRYABLE_STATUS = new Set([401, 402, 403, 408, 429, 500, 502, 503, 504])

function isRetryable(err: unknown): boolean {
  if (!axios.isAxiosError(err)) return false
  if (!err.response) return true // network error / timeout — no response at all
  return RETRYABLE_STATUS.has(err.response.status)
}

// TODO.md Improvement #10. A response cut off by the token ceiling isn't an
// account problem (retrying on another account truncates identically — same
// model, same max_tokens, same prompt) and isn't a "malformed JSON, retry
// might help" case either (chatJSON's parse-retry sends a corrective nudge,
// not a shorter prompt, so it truncates again too). Distinguishing this from
// a generic failure lets both retry loops fail fast instead of burning a
// second doomed call. Not an AxiosError, so isRetryable() above already
// treats it as non-retryable without any extra casing.
export class TruncatedResponseError extends Error {
  constructor(model: string, maxTokens?: number) {
    super(
      `DeepSeek response truncated at the token ceiling (model=${model}` +
      `${maxTokens != null ? `, max_tokens=${maxTokens}` : ''}) — retrying the identical request would truncate again.`
    )
    this.name = 'TruncatedResponseError'
  }
}

// How long a failed account is deprioritized (not excluded — see
// orderAccounts below) after a retryable failure. Short enough that a
// transient blip (one rate-limit spike) doesn't sideline an account for
// long, long enough that a genuinely broken account doesn't cost every
// subsequent call an extra failed round-trip before falling through.
const COOLDOWN_MS = 5 * 60 * 1000
const downUntil = new Map<string, number>()

interface DeepSeekAccount {
  label:   string
  apiKey:  string
  baseUrl: string
}

function resolveAccounts(): DeepSeekAccount[] {
  const accounts: DeepSeekAccount[] = []

  const primaryKey = process.env.DEEPSEEK_API_KEY
  if (primaryKey) {
    accounts.push({
      label:   process.env.DEEPSEEK_ACCOUNT_NAME?.trim() || 'primary',
      apiKey:  primaryKey,
      baseUrl: process.env.DEEPSEEK_BASE_URL?.trim() || DEFAULT_BASE_URL,
    })
  }

  for (let i = 2; i <= MAX_ACCOUNTS; i++) {
    const key = process.env[`DEEPSEEK_API_KEY_${i}`]
    if (!key) continue
    accounts.push({
      label:   process.env[`DEEPSEEK_ACCOUNT_NAME_${i}`]?.trim() || `key-${i}`,
      apiKey:  key,
      baseUrl: process.env[`DEEPSEEK_BASE_URL_${i}`]?.trim() || DEFAULT_BASE_URL,
    })
  }

  return accounts
}

// Healthy-looking accounts first, cooling-down accounts last — but every
// account stays eligible. If every account is cooling down (worst case: all
// are genuinely broken, or we just haven't reached the cooldown expiry yet),
// we still try the least-recently-failed one rather than giving up without
// an attempt — a stale cooldown flag must never turn into "no accounts to
// try at all".
function orderAccounts(accounts: DeepSeekAccount[]): DeepSeekAccount[] {
  const now = Date.now()
  const healthy = accounts.filter((a) => (downUntil.get(a.label) ?? 0) <= now)
  const cooling = accounts
    .filter((a) => (downUntil.get(a.label) ?? 0) > now)
    .sort((a, b) => (downUntil.get(a.label) ?? 0) - (downUntil.get(b.label) ?? 0))
  return [...healthy, ...cooling]
}

// Falling back to a secondary account is, from the caller's point of view, a
// successful call — no error propagates, so the generic error-handler's
// Telegram alert (which only fires on a thrown/unhandled error) never sees
// it. Without a dedicated alert here, the platform could silently run on
// its last working account for weeks and nobody would know until that one
// failed too — the exact quiet-failure shape the 2026-07-24 incident was
// about, one layer up. Dedup reuses sendTelegramAlert's existing 15-minute
// per-code window, so a retry storm doesn't spam the chat.
function notifyFallback(failedLabel: string, usedLabel: string, reason: string): void {
  logger.warn({ message: 'DeepSeek account failed, fell back to next account', failedAccount: failedLabel, usedAccount: usedLabel, reason })
  sendTelegramAlert({
    code:    'DEEPSEEK_ACCOUNT_FALLBACK',
    message: `DeepSeek account "${failedLabel}" failed (${reason}) — now running on "${usedLabel}". Check the failed account's balance/status.`,
  }).catch(() => null)
}

export class DeepSeekProvider implements LLMProvider {
  name: 'deepseek' = 'deepseek'
  capabilities = CAPABILITIES

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const accounts = resolveAccounts()
    if (accounts.length === 0) throw new Error('DEEPSEEK_API_KEY is not set')

    const ordered = orderAccounts(accounts)
    let lastErr: unknown

    for (let i = 0; i < ordered.length; i++) {
      const account = ordered[i]
      try {
        const content = await this.attemptChat(account, messages, opts)
        if (i > 0) notifyFallback(ordered[i - 1].label, account.label, describeError(lastErr))
        downUntil.delete(account.label) // recovered — clear any stale cooldown
        return content
      } catch (err) {
        lastErr = err
        if (!isRetryable(err)) throw err
        downUntil.set(account.label, Date.now() + COOLDOWN_MS)
        logger.warn({ message: 'DeepSeek account attempt failed, trying next account', account: account.label, error: describeError(err), remaining: ordered.length - i - 1 })
      }
    }
    throw lastErr
  }

  /** One HTTP attempt against one account. Throws on failure — the caller
   *  (chat, above) decides whether to retry on a different account. */
  private async attemptChat(account: DeepSeekAccount, messages: ChatMessage[], opts: ChatOptions): Promise<string> {
    const start = Date.now()
    // Tiered routing: reasoner → PRO with thinking on; everything else → FLASH
    // with thinking off. Thinking is a body toggle in V4, not a separate model,
    // and it defaults to ENABLED — so we must set it explicitly on every call,
    // otherwise the bulk passes silently switch to slow/expensive reasoning.
    const thinking = !!opts.reasoner
    const model = thinking ? PRO_MODEL() : FLASH_MODEL()

    try {
      const response = await axios.post(
        `${account.baseUrl}/chat/completions`,
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
            Authorization:  `Bearer ${account.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: thinking ? 110_000 : 60_000,
        }
      )

      const usage        = response.data.usage as { prompt_tokens: number; completion_tokens: number }
      const inputTokens  = usage?.prompt_tokens     ?? 0
      const outputTokens = usage?.completion_tokens ?? 0
      const choice       = response.data.choices[0]

      // TODO.md Improvement #10 — a truncated response hit the token ceiling,
      // not a transient failure; returning it would let chatJSON's parse-retry
      // burn a second identical (and identically doomed) call. Log it as its
      // own clearly-labeled, accurately-costed row (real token counts, not the
      // catch block's 0/0) rather than the two generic failed-call rows this
      // used to produce, then fail fast.
      if (choice.finish_reason === 'length') {
        if (opts.context) {
          const costUsd = calculateDeepSeekCost(inputTokens, outputTokens, model)
          createUsageLog({
            ...opts.context,
            model:        `deepseek:${model}`,
            inputTokens,
            outputTokens,
            costUsd,
            costNative:   costUsd,
            currency:     'USD',
            account:      account.label,
            durationMs:   Date.now() - start,
            success:      false,
            errorCode:    'TRUNCATED',
          }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
        }
        logger.warn({
          message: 'DeepSeek response truncated at token ceiling — not retrying (identical request would truncate again)',
          feature: opts.context?.feature, model, account: account.label, outputTokens, maxTokens: opts.maxTokens,
        })
        throw new TruncatedResponseError(model, opts.maxTokens)
      }

      if (opts.context) {
        const costUsd = calculateDeepSeekCost(inputTokens, outputTokens, model)
        createUsageLog({
          ...opts.context,
          model:        `deepseek:${model}`,
          inputTokens,
          outputTokens,
          costUsd,
          costNative:   costUsd,
          currency:     'USD',
          account:      account.label,
          durationMs:   Date.now() - start,
          success:      true,
        }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
      }

      // In V4 thinking mode the chain-of-thought is in message.reasoning_content
      // (billed as output tokens); the actual answer stays in message.content.
      // We deliberately return only content — never the CoT.
      return choice.message.content as string

    } catch (err) {
      // Already logged (with accurate token counts) and warned above — avoid
      // a second, less-informative "HTTP_0"/0-token failure row for the same event.
      if (err instanceof TruncatedResponseError) throw err

      const errorCode = axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN'

      if (opts.context) {
        createUsageLog({
          ...opts.context,
          model:        `deepseek:${model}`,
          inputTokens:  0, outputTokens: 0, costUsd: 0,
          currency:     'USD',
          account:      account.label,
          durationMs:   Date.now() - start,
          success:      false,
          errorCode,
        }).catch(() => null)
      }
      logger.warn({ message: 'DeepSeek call failed', feature: opts.context?.feature, model, account: account.label, errorCode })
      throw err
    }
  }

  // Feature AN Phase 2 follow-up (TODO.md "### AN") — captions a figure
  // image via deepseek-v4-flash-vision-exp. Deliberately NOT part of the
  // LLMProvider interface (same "always this provider, no per-institution
  // routing" shape as embed() always being Yandex) — see types.ts's
  // VisionContentPart doc comment for why it's a standalone method instead
  // of widening ChatMessage.content.
  //
  // Never throws — returns null on any failure (disabled, no accounts, every
  // account exhausted, malformed response). This is a best-effort quality
  // enhancement over figureCaptioning.ts's OCR+text fallback, not a
  // must-succeed call; the caller degrades to that fallback on null.
  async captionImage(
    imageBuffer: Buffer,
    mimeType:    string,
    promptText:  string,
    context?:    CallContext,
  ): Promise<{ caption: string; labels: string[] } | null> {
    if (!isVisionEnabled()) return null
    const accounts = resolveAccounts()
    if (accounts.length === 0) return null

    const ordered = orderAccounts(accounts)
    let lastErr: unknown

    for (let i = 0; i < ordered.length; i++) {
      const account = ordered[i]
      try {
        const result = await this.attemptCaptionImage(account, imageBuffer, mimeType, promptText, context)
        if (i > 0) notifyFallback(ordered[i - 1].label, account.label, describeError(lastErr))
        downUntil.delete(account.label)
        return result
      } catch (err) {
        lastErr = err
        if (!isRetryable(err)) break
        downUntil.set(account.label, Date.now() + COOLDOWN_MS)
        logger.warn({ message: 'DeepSeek vision attempt failed, trying next account', account: account.label, error: describeError(err), remaining: ordered.length - i - 1 })
      }
    }
    logger.warn({ message: 'DeepSeek vision captioning failed on every account — falling back', error: describeError(lastErr) })
    return null
  }

  private async attemptCaptionImage(
    account:     DeepSeekAccount,
    imageBuffer: Buffer,
    mimeType:    string,
    promptText:  string,
    context?:    CallContext,
  ): Promise<{ caption: string; labels: string[] }> {
    const start = Date.now()
    const model = VISION_MODEL()
    const content: VisionContentPart[] = [
      { type: 'text', text: promptText },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBuffer.toString('base64')}`, detail: 'auto' } },
    ]

    try {
      const response = await axios.post(
        `${account.baseUrl}/chat/completions`,
        {
          model,
          messages: [{ role: 'user', content }],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_tokens: 300,
        },
        {
          headers: { Authorization: `Bearer ${account.apiKey}`, 'Content-Type': 'application/json' },
          timeout: 45_000,
        }
      )

      const usage        = response.data.usage as { prompt_tokens: number; completion_tokens: number } | undefined
      const inputTokens  = usage?.prompt_tokens     ?? 0
      const outputTokens = usage?.completion_tokens ?? 0
      const raw          = response.data.choices?.[0]?.message?.content as string | undefined

      if (context) {
        const costUsd = calculateDeepSeekCost(inputTokens, outputTokens, 'deepseek-v4-flash')
        createUsageLog({
          ...context, model: `deepseek:${model}`, inputTokens, outputTokens, costUsd,
          costNative: costUsd, currency: 'USD', account: account.label,
          durationMs: Date.now() - start, success: true,
        }).catch((e) => logger.warn({ message: 'Failed to write usage log', error: e.message }))
      }

      if (!raw) return { caption: '', labels: [] }
      const parsed = JSON.parse(extractJSON(raw)) as { caption?: unknown; labels?: unknown }
      return {
        caption: typeof parsed.caption === 'string' ? parsed.caption.trim() : '',
        labels:  Array.isArray(parsed.labels) ? parsed.labels.filter((l): l is string => typeof l === 'string') : [],
      }
    } catch (err) {
      const errorCode = axios.isAxiosError(err) ? `HTTP_${err.response?.status ?? 0}` : 'UNKNOWN'
      if (context) {
        createUsageLog({
          ...context, model: `deepseek:${model}`, inputTokens: 0, outputTokens: 0, costUsd: 0,
          currency: 'USD', account: account.label, durationMs: Date.now() - start, success: false, errorCode,
        }).catch(() => null)
      }
      logger.warn({ message: 'DeepSeek vision call failed', feature: context?.feature, model, account: account.label, errorCode })
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

function describeError(err: unknown): string {
  if (axios.isAxiosError(err)) return err.response ? `HTTP ${err.response.status}` : (err.code ?? 'network error')
  return err instanceof Error ? err.message : 'unknown error'
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
