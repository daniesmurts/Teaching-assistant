// Registry that exposes the same chat/chatJSON/embed surface the rest of the
// codebase used before Phase 4, but routes per the resolved provider for the
// caller's context. Provider resolution honours:
//
//   1. Per-institution override (institutions.preferred_provider). Wired in
//      migration 037 — until then, every caller falls through to the default.
//   2. Global default (env DEFAULT_PROVIDER, otherwise 'deepseek').
//
// Embedding calls always go through Yandex regardless — vector-space
// compatibility is a hard technical constraint, not a configuration.
//
// Silent fallback policy: if the chosen provider throws AND it isn't already
// DeepSeek, retry once on DeepSeek and log a warning. DeepSeek may itself be
// self-hosted on RU infrastructure long-term (institution sovereignty stays
// intact regardless of which provider answered).

import { logger } from '../../lib/logger'
import { DeepSeekProvider } from './deepseek'
import { YandexProvider }   from './yandex'
import { QwenProvider }     from './qwen'
import { checkSpendCap } from '../spendCap'
import { checkGlobalSpendCap } from '../globalSpendCap'
import type {
  CallContext, ChatMessage, ChatOptions, LLMProvider, ProviderName,
} from './types'

const PROVIDERS: Record<ProviderName, LLMProvider> = {
  deepseek: new DeepSeekProvider(),
  yandex:   new YandexProvider(),
  qwen:     new QwenProvider(),
  // gigachat is Phase 4 v2 — stub raises if anyone tries to use it.
  gigachat: new (class implements LLMProvider {
    name: 'gigachat' = 'gigachat'
    capabilities = { strictJsonMode: false, reasonerMode: false, maxOutputTokens: 4096 }
    async chat(): Promise<string>   { throw new Error('GigaChat provider not implemented yet') }
    async chatJSON<T>(): Promise<T> { throw new Error('GigaChat provider not implemented yet') }
    embed(text: string, ctx?: CallContext) { return PROVIDERS.yandex.embed(text, ctx) }
  })(),
}

export const DEEPSEEK = PROVIDERS.deepseek    // exported for callers that need the literal provider (calc mode)

function defaultProviderName(): ProviderName {
  const env = process.env.DEFAULT_LLM_PROVIDER as ProviderName | undefined
  if (env && env in PROVIDERS) return env
  return 'deepseek'
}

// Per-institution preferred provider is resolved lazily — the migration that
// adds the column lands in 037, and the lookup is wired in then. Until that
// migration is applied, this returns null and every caller uses the default.
//
// Wired in services/llm/institutionResolver.ts to avoid a circular import
// with the institutions queries module that uses the registry indirectly.
type Resolver = (institutionId: string) => Promise<ProviderName | null>
let institutionResolver: Resolver | null = null
export function registerInstitutionResolver(fn: Resolver): void {
  institutionResolver = fn
}

/**
 * Resolve which provider would handle a call for this context. Exported so
 * services can record `ai_provider` on grade rows without duplicating the
 * routing logic. Returns the silent-fallback-eligible primary provider; the
 * actual call might still fall back to DeepSeek on failure, in which case
 * the recorded value remains the *intended* provider — that's the right
 * semantic ("this institution asked for Yandex").
 *
 * Calc-mode grading (opts.reasoner) always lands on DeepSeek regardless of
 * the institution preference — there's no reasoner equivalent elsewhere.
 */
export async function getActiveProviderName(
  ctx?:  CallContext,
  opts?: { reasoner?: boolean },
): Promise<ProviderName> {
  if (opts?.reasoner) return 'deepseek'
  return (await resolveProvider(ctx)).name
}

async function resolveProvider(ctx?: CallContext): Promise<LLMProvider> {
  if (ctx?.institutionId && institutionResolver) {
    try {
      const name = await institutionResolver(ctx.institutionId)
      if (name && PROVIDERS[name]) return PROVIDERS[name]
    } catch (err) {
      logger.warn({ message: 'Institution provider lookup failed', err: (err as Error).message })
    }
  }
  return PROVIDERS[defaultProviderName()]
}

// ─── Public API — drop-in replacement for services/deepseek.ts exports ──────

export async function chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  await checkGlobalSpendCap()
  if (opts.context?.teacherId) await checkSpendCap(opts.context.teacherId)
  // An explicit override that itself has a reasoner wins even under
  // opts.reasoner — this is what lets a blind cross-provider verification
  // pass (e.g. Qwen-thinking recomputing what DeepSeek-reasoner graded)
  // actually land on the requested provider instead of being silently
  // redirected to DeepSeek. An override lacking reasoner support falls
  // through to the DeepSeek-reasoner default below.
  if (opts.providerOverride && PROVIDERS[opts.providerOverride]) {
    const overridden = PROVIDERS[opts.providerOverride]
    if (!opts.reasoner || overridden.capabilities.reasonerMode) {
      return overridden.chat(messages, opts)
    }
  }
  if (opts.reasoner) {
    return PROVIDERS.deepseek.chat(messages, opts)
  }
  const primary = await resolveProvider(opts.context)
  try {
    return await primary.chat(messages, opts)
  } catch (err) {
    return fallbackOrThrow(primary, err, () => PROVIDERS.deepseek.chat(messages, opts), 'chat')
  }
}

export async function chatJSON<T>(
  messages:   ChatMessage[],
  retryLabel = 'response',
  opts:       ChatOptions = {},
): Promise<T> {
  await checkGlobalSpendCap()
  if (opts.context?.teacherId) await checkSpendCap(opts.context.teacherId)
  // Calc grading uses the reasoner. An explicit providerOverride that itself
  // has a reasoner (e.g. Qwen-thinking, for a blind cross-provider
  // recomputation pass) is honoured; otherwise reasoner calls route directly
  // to DeepSeek regardless of the institution's preferred provider, skipping
  // the fallback ladder (there's nowhere else to go). The institutional
  // sovereignty story handles this via the help-article carve-out.
  if (opts.providerOverride && PROVIDERS[opts.providerOverride]) {
    const overridden = PROVIDERS[opts.providerOverride]
    if (!opts.reasoner || overridden.capabilities.reasonerMode) {
      return overridden.chatJSON<T>(messages, retryLabel, opts)
    }
  }
  if (opts.reasoner) {
    return PROVIDERS.deepseek.chatJSON<T>(messages, retryLabel, opts)
  }
  const primary = await resolveProvider(opts.context)
  try {
    return await primary.chatJSON<T>(messages, retryLabel, opts)
  } catch (err) {
    return fallbackOrThrow(primary, err, () => PROVIDERS.deepseek.chatJSON<T>(messages, retryLabel, opts), 'chatJSON')
  }
}

export function embed(text: string, ctx?: CallContext): Promise<number[]> {
  // Always Yandex — never falls back, embeddings can't change provider safely.
  return PROVIDERS.yandex.embed(text, ctx)
}

// Silent fallback — when the institution-chosen provider fails and it isn't
// DeepSeek already, retry on DeepSeek and log. The institution may have asked
// for Yandex specifically for sovereignty; DeepSeek self-hosted on our RU
// infra preserves that promise.
async function fallbackOrThrow<T>(
  primary:  LLMProvider,
  err:      unknown,
  retryFn:  () => Promise<T>,
  surface:  string,
): Promise<T> {
  if (primary.name === 'deepseek') throw err   // already on the fallback provider
  logger.warn({
    message:  'LLM provider failed; falling back to DeepSeek',
    surface,
    primary:  primary.name,
    error:    (err as Error).message,
  })
  return retryFn()
}
