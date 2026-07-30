// Platform-wide daily spend circuit breaker, scoped to ONE feature (or one
// feature+variant pair) rather than the whole platform — the third variant
// of a pattern that already exists twice (spendCap.ts per-teacher monthly,
// globalSpendCap.ts platform daily). TODO.md Feature AL Phase 4.
//
// The gap this closes: today the only platform-level lever is
// globalSpendCap.ts, and tripping it kills grading along with whatever
// actually ran away. Motivated directly by deep-mode presentations —
// "imagine deep mode becomes very popular; I wouldn't want the numbers to
// sink the whole business" — a per-feature ceiling lets deep presentations
// throttle while grading stays up.
//
// Variant-aware: if a variant-specific cap is set (e.g.
// FEATURE_SPEND_CAP_PRESENTATION_DEEP_USD), it's checked FIRST, on top of
// (not instead of) the feature-level cap — a deep-specific ceiling can trip
// even while the broader 'presentation' feature stays under its own cap.
// Both disabled (Infinity) by default, same posture as globalSpendCap.ts:
// zero effect until an operator deliberately sets a number for their
// current traffic.

import { pool } from '../db/connection'
import { FeatureSpendCapExceededError } from '../errors/AppError'
import { logger } from '../lib/logger'

interface CacheEntry {
  spendUsd: number
  at:       number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 60 * 1000   // short — this gates real spend, not a static config value

/** Pure — same parsing rule as globalSpendCap.ts's parseDailyCapUsd, split out so it's unit-testable without env/DB juggling. */
export function parseFeatureCapUsd(raw: string | undefined): number {
  if (!raw) return Infinity
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : Infinity
}

/** Pure — FEATURE_SPEND_CAP_PRESENTATION_DEEP_USD for (presentation, deep), FEATURE_SPEND_CAP_PRESENTATION_USD for (presentation, undefined). Uppercased, non-alphanumeric stripped to underscore so a feature/variant value can't inject an arbitrary env var name. */
export function featureCapEnvKey(feature: string, variant?: string | null): string {
  const clean = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return variant ? `FEATURE_SPEND_CAP_${clean(feature)}_${clean(variant)}_USD` : `FEATURE_SPEND_CAP_${clean(feature)}_USD`
}

function cacheKey(feature: string, variant?: string | null): string {
  return variant ? `${feature}:${variant}` : feature
}

async function currentDaySpendForFeature(feature: string, variant?: string | null): Promise<number> {
  const { rows } = await pool.query<{ cost: string }>(
    variant
      ? `SELECT COALESCE(SUM(cost_usd), 0)::text AS cost
           FROM api_usage_log
          WHERE feature = $1 AND variant = $2 AND created_at >= date_trunc('day', NOW())`
      : `SELECT COALESCE(SUM(cost_usd), 0)::text AS cost
           FROM api_usage_log
          WHERE feature = $1 AND created_at >= date_trunc('day', NOW())`,
    variant ? [feature, variant] : [feature]
  )
  return parseFloat(rows[0]?.cost ?? '0')
}

async function refresh(feature: string, variant: string | null | undefined): Promise<CacheEntry> {
  const entry = { spendUsd: await currentDaySpendForFeature(feature, variant), at: Date.now() }
  cache.set(cacheKey(feature, variant), entry)
  return entry
}

async function checkOne(feature: string, variant: string | null | undefined): Promise<void> {
  const cap = parseFeatureCapUsd(process.env[featureCapEnvKey(feature, variant)])
  if (cap === Infinity) return

  const cached = cache.get(cacheKey(feature, variant))
  const entry = cached && Date.now() - cached.at < TTL_MS ? cached : await refresh(feature, variant)

  if (entry.spendUsd >= cap) throw new FeatureSpendCapExceededError(variant ? `${feature}:${variant}` : feature)
}

/**
 * Throws FeatureSpendCapExceededError if the platform's spend today on this
 * feature (or feature+variant, if a variant-specific cap is set) is at or
 * above its configured cap. No-op (fail-open) on infra errors, and a no-op
 * entirely when neither cap is set.
 */
export async function checkFeatureSpendCap(feature: string, variant?: string | null): Promise<void> {
  try {
    if (variant) await checkOne(feature, variant)
    await checkOne(feature, null)
  } catch (err) {
    if (err instanceof FeatureSpendCapExceededError) throw err
    logger.warn({ message: '[FeatureSpendCap] Check failed, allowing call through', feature, variant, error: (err as Error).message })
  }
}

// Test-only — clears the module-level cache between test cases (the 60s TTL
// otherwise leaks a stale spend figure across tests in the same file run).
export function _resetCacheForTests(): void {
  cache.clear()
}
