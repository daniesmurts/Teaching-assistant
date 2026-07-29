// Platform-wide daily spend circuit breaker — distinct from spendCap.ts's
// per-teacher monthly cap. A burst of concurrent generations (e.g. many
// teachers starting decks at once, or Phase 1's per-slide expansion calls
// multiplying token spend ~5x) can rack up real cost quickly even when every
// individual teacher stays under their own cap. This is a blunt platform-
// level backstop, not a billing mechanism — same fail-open/fail-closed
// philosophy as spendCap.ts: infra errors never block a call, but a real
// breach does.
//
// Disabled by default (GLOBAL_DAILY_SPEND_CAP_USD unset → Infinity) so this
// has zero effect until an operator deliberately sets a number for their
// current infrastructure.

import { pool } from '../db/connection'
import { GlobalSpendCapExceededError } from '../errors/AppError'
import { logger } from '../lib/logger'

interface CacheEntry {
  spendUsd: number
  at:       number
}

let cache: CacheEntry | null = null
const TTL_MS = 60 * 1000   // short — this gates real spend, not a static config value

/** Pure parsing rule, split out so it's unit-testable without env/DB juggling. */
export function parseDailyCapUsd(raw: string | undefined): number {
  if (!raw) return Infinity
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : Infinity
}

function dailyCapUsd(): number {
  return parseDailyCapUsd(process.env.GLOBAL_DAILY_SPEND_CAP_USD)
}

async function currentDaySpend(): Promise<number> {
  const { rows } = await pool.query<{ cost: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0)::text AS cost
       FROM api_usage_log
      WHERE created_at >= date_trunc('day', NOW())`
  )
  return parseFloat(rows[0]?.cost ?? '0')
}

/**
 * Throws GlobalSpendCapExceededError if the platform's spend today is at or
 * above GLOBAL_DAILY_SPEND_CAP_USD. No-op (fail-open) on infra errors, and a
 * no-op entirely when the cap is unset.
 */
export async function checkGlobalSpendCap(): Promise<void> {
  const cap = dailyCapUsd()
  if (cap === Infinity) return

  try {
    const spend = cache && Date.now() - cache.at < TTL_MS
      ? cache.spendUsd
      : (cache = { spendUsd: await currentDaySpend(), at: Date.now() }).spendUsd

    if (spend >= cap) throw new GlobalSpendCapExceededError()
  } catch (err) {
    if (err instanceof GlobalSpendCapExceededError) throw err
    logger.warn({ message: '[GlobalSpendCap] Check failed, allowing call through', error: (err as Error).message })
  }
}
