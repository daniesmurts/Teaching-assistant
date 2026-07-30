// TODO.md Feature AL Phase 3 — capacity report refinement + provider
// ceilings. Two things Phase 2's headroom model explicitly deferred:
//   1. Peak-to-mean ratio — capacity is set by peak concurrency, not the
//      monthly average Phase 2's headroom model used. This product's load
//      is violently seasonal (сессия in январь/июнь, РПД work at semester
//      start, flat summer), so the same teacher growth is a non-event in
//      July and an incident in December — a mean-based estimate alone
//      understates real risk.
//   2. The three provider ceilings, which fail differently and need
//      separating: account balance (402, sudden/total), rate limit (429,
//      a concurrency wall), and pool depth (accounts configured vs.
//      recently unhealthy).

import { getHourlyVolume, getHourlyRateLimitBuckets, getAccountSummaries, type AccountSummary } from '../db/queries/providerCeilings'

export const DEFAULT_WINDOW_DAYS = 30

// ─── Peak-to-mean ────────────────────────────────────────────────────────

/**
 * Pure — ratio of the single busiest hour's call volume to the mean hourly
 * volume across the WHOLE window (including silent hours — a window of
 * `days` always has `days * 24` hours, most of which have zero calls
 * overnight; averaging only over hours-with-activity would understate the
 * ratio). Null when there's nothing to compute from.
 */
export function computePeakToMeanRatio(totalCalls: number, peakHourlyCalls: number, windowDays: number): number | null {
  const totalHours = windowDays * 24
  if (totalHours <= 0 || totalCalls <= 0 || peakHourlyCalls <= 0) return null
  const meanHourly = totalCalls / totalHours
  if (meanHourly <= 0) return null
  return peakHourlyCalls / meanHourly
}

export async function getPeakToMeanRatio(windowDays = DEFAULT_WINDOW_DAYS): Promise<{ ratio: number | null; totalCalls: number; peakHourlyCalls: number }> {
  const { totalCalls, peakHourlyCalls } = await getHourlyVolume(windowDays)
  return { ratio: computePeakToMeanRatio(totalCalls, peakHourlyCalls, windowDays), totalCalls, peakHourlyCalls }
}

// ─── Rate-limit knee (429) ─────────────────────────────────────────────────

export interface RateLimitKnee {
  observed:                          boolean   // did we ever actually hit a 429 in the window?
  minHourlyVolumeWithRateLimit:       number | null   // smallest hourly call volume where a 429 occurred
  maxHourlyVolumeWithoutRateLimit:    number | null   // largest hourly call volume that stayed clean
}

/**
 * Pure — the empirical rate-limit ceiling isn't a documented number (DeepSeek
 * doesn't publish one usefully), so it's derived from what actually
 * happened: the smallest hourly volume that DID trip a 429 brackets the
 * ceiling from above, the largest hourly volume that DIDN'T brackets it
 * from below. `observed: false` means production has never actually been
 * rate-limited — there's no knee to find yet, and reporting a fabricated
 * one would be worse than reporting nothing (TODO.md's own framing).
 */
export function computeRateLimitKnee(hourly: Array<{ calls: number; rateLimited: number }>): RateLimitKnee {
  const withLimit    = hourly.filter((h) => h.rateLimited > 0).map((h) => h.calls)
  const withoutLimit = hourly.filter((h) => h.rateLimited === 0).map((h) => h.calls)
  return {
    observed: withLimit.length > 0,
    minHourlyVolumeWithRateLimit:    withLimit.length    ? Math.min(...withLimit)    : null,
    maxHourlyVolumeWithoutRateLimit: withoutLimit.length ? Math.max(...withoutLimit) : null,
  }
}

export async function getRateLimitKnee(windowDays = DEFAULT_WINDOW_DAYS): Promise<RateLimitKnee> {
  const buckets = await getHourlyRateLimitBuckets(windowDays)
  return computeRateLimitKnee(buckets)
}

// ─── Account ceilings — balance + pool depth ───────────────────────────────

export interface AccountCeiling {
  account:           string
  burnRatePerDayUsd: number
  balanceFailures:   number
  failureCount:      number
  lastSuccessAt:      string | null
  lastFailureAt:      string | null
  // A recent failure with no success since is the closest historical proxy
  // for "currently unhealthy" this data supports — real cooldown state
  // (llm/deepseek.ts's downUntil map) is in-process and per-PM2-worker, not
  // centrally queryable, so this is evidence, not a live status.
  possiblyUnhealthy: boolean
}

export function computeAccountCeiling(summary: AccountSummary, windowDays: number): AccountCeiling {
  const burnRatePerDayUsd = windowDays > 0 ? summary.totalCostUsd / windowDays : 0
  const lastFailureAfterSuccess =
    summary.lastFailureAt != null &&
    (summary.lastSuccessAt == null || new Date(summary.lastFailureAt) > new Date(summary.lastSuccessAt))
  return {
    account: summary.account,
    burnRatePerDayUsd,
    balanceFailures: summary.balanceFailures,
    failureCount:    summary.failureCount,
    lastSuccessAt:   summary.lastSuccessAt,
    lastFailureAt:   summary.lastFailureAt,
    possiblyUnhealthy: lastFailureAfterSuccess,
  }
}

export async function getAccountCeilings(windowDays = DEFAULT_WINDOW_DAYS): Promise<AccountCeiling[]> {
  const summaries = await getAccountSummaries(windowDays)
  return summaries.map((s) => computeAccountCeiling(s, windowDays))
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

export interface ProviderCeilingsReport {
  windowDays:       number
  peakToMean:       { ratio: number | null; totalCalls: number; peakHourlyCalls: number }
  rateLimitKnee:    RateLimitKnee
  accounts:         AccountCeiling[]
  // Static risk, not a metric — invariant #9 forces ALL embeddings through
  // Yandex and llm/yandex.ts has no multi-account pool (unlike DeepSeek,
  // which got one after a real 402 incident). Surfaced here rather than
  // buried in a comment because it's exactly the kind of "worth recording
  // as a risk with no mitigation" item this phase exists to make visible.
  yandexEmbedSpofNote: string
}

export async function getProviderCeilingsReport(windowDays = DEFAULT_WINDOW_DAYS): Promise<ProviderCeilingsReport> {
  const [peakToMean, rateLimitKnee, accounts] = await Promise.all([
    getPeakToMeanRatio(windowDays),
    getRateLimitKnee(windowDays),
    getAccountCeilings(windowDays),
  ])
  return {
    windowDays, peakToMean, rateLimitKnee, accounts,
    yandexEmbedSpofNote:
      'Все эмбеддинги идут только через Yandex (архитектурное требование — совместимость векторного пространства) — ' +
      'в отличие от DeepSeek (5 аккаунтов с 2026-07-24), у Yandex нет пула аккаунтов и переключения при сбое. ' +
      'Риск без смягчения — если этот единственный аккаунт исчерпает баланс, весь RAG-конвейер останавливается.',
  }
}
