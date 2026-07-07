// Per-teacher monthly spend cap — a cost circuit breaker, not a plan gate.
//
// Enforced once, centrally, in llm/registry.ts (chat/chatJSON) so every
// caller is covered regardless of which route or background job triggered
// the LLM call — the same reasoning as embed() always routing through
// Yandex: one choke point beats N call sites that could each forget it.
//
// Fails OPEN on infra errors (DB down, etc.) — a spend-cap check must never
// be the reason grading breaks. Fails CLOSED (blocks) only when the spend
// really is over the resolved cap. Same philosophy as
// confidence.ts:getActiveThresholds ("never let config loading block grading").

import { pool } from '../db/connection'
import { PLAN_LIMITS } from '../config/planLimits'
import { computeEffectiveTier } from '../lib/planTier'
import { SpendCapExceededError } from '../errors/AppError'
import { logger } from '../lib/logger'

interface CapCacheEntry {
  capUsd:    number
  spendUsd:  number
  at:        number
}

const cache = new Map<string, CapCacheEntry>()
const TTL_MS = 60 * 1000   // short — this gates real spend, not a static config value

/**
 * Pure precedence rule: an explicit per-teacher override always wins; absent
 * that, fall back to the effective tier's default (unknown/missing tier →
 * free, the safest default). Split out from resolveCap so the branching is
 * unit-testable without a DB.
 */
export function pickEffectiveCap(overrideUsd: number | null, tier: string): number {
  if (overrideUsd != null) return overrideUsd
  return (PLAN_LIMITS[tier as keyof typeof PLAN_LIMITS] ?? PLAN_LIMITS.free).monthlySpendCapUsd
}

/** Resolve the effective monthly cap for a teacher: explicit override, else plan-tier default. */
async function resolveCap(teacherId: string): Promise<number> {
  const { rows } = await pool.query<{
    plan_tier:             string | null
    plan_expires_at:       Date | null
    institution_id:        string | null
    institution_plan_tier: string | null
    monthly_spend_cap_usd: string | null
  }>(
    `SELECT t.plan_tier, t.plan_expires_at, t.institution_id,
            i.plan_tier AS institution_plan_tier,
            t.monthly_spend_cap_usd
       FROM teachers t
       LEFT JOIN institutions i ON i.id = t.institution_id
      WHERE t.id = $1
      LIMIT 1`,
    [teacherId]
  )
  const row = rows[0]
  if (!row) return PLAN_LIMITS.free.monthlySpendCapUsd

  const override = row.monthly_spend_cap_usd != null ? Number(row.monthly_spend_cap_usd) : null
  return pickEffectiveCap(override, computeEffectiveTier(row))
}

async function currentMonthSpend(teacherId: string): Promise<number> {
  const { rows } = await pool.query<{ cost: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::text AS cost
       FROM api_usage_log
      WHERE teacher_id = $1
        AND created_at >= date_trunc('month', NOW())`,
    [teacherId]
  )
  return parseFloat(rows[0]?.cost ?? '0')
}

async function refresh(teacherId: string): Promise<CapCacheEntry> {
  const [capUsd, spendUsd] = await Promise.all([resolveCap(teacherId), currentMonthSpend(teacherId)])
  const entry = { capUsd, spendUsd, at: Date.now() }
  cache.set(teacherId, entry)
  return entry
}

/**
 * Throws SpendCapExceededError if this teacher's spend this calendar month
 * is at or above their effective cap. No-op (fail-open) on infra errors —
 * logs a warning instead of blocking the call.
 */
export async function checkSpendCap(teacherId: string): Promise<void> {
  try {
    const cached = cache.get(teacherId)
    const entry = cached && Date.now() - cached.at < TTL_MS ? cached : await refresh(teacherId)

    if (entry.spendUsd >= entry.capUsd) throw new SpendCapExceededError(entry.capUsd)
  } catch (err) {
    if (err instanceof SpendCapExceededError) throw err
    logger.warn({ message: '[SpendCap] Check failed, allowing call through', teacherId, error: (err as Error).message })
  }
}

/** Admin changed a teacher's override — drop the cached value so the new cap applies immediately. */
export function invalidateSpendCapCache(teacherId: string): void {
  cache.delete(teacherId)
}
