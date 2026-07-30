import { pool } from '../connection'

// TODO.md Feature AL Phase 3 — raw queries behind services/providerCeilings.ts.
// Everything here is derived from api_usage_log's existing columns (no new
// tables) — peak-to-mean from hourly created_at buckets, the 429 knee from
// the same buckets split by error_code, and per-account burn/failure
// history from the `account` column Phase 0 added.

export interface HourlyVolume {
  totalCalls:      number
  peakHourlyCalls: number
}

/** Total calls + the single busiest hour's call count, over the trailing `days`. Used for the peak-to-mean ratio — see services/providerCeilings.ts. */
export async function getHourlyVolume(days: number): Promise<HourlyVolume> {
  const { rows } = await pool.query<{ total_calls: number; peak_hourly_calls: number }>(
    `WITH hourly AS (
       SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS calls
         FROM api_usage_log
        WHERE created_at >= NOW() - ($1 || ' days')::interval
        GROUP BY 1
     )
     SELECT COALESCE(SUM(calls), 0)::int AS total_calls,
            COALESCE(MAX(calls), 0)::int AS peak_hourly_calls
       FROM hourly`,
    [days]
  )
  return { totalCalls: rows[0]?.total_calls ?? 0, peakHourlyCalls: rows[0]?.peak_hourly_calls ?? 0 }
}

export interface HourlyRateLimitBucket {
  calls:       number
  rateLimited: number
}

/** Per-hour (call volume, 429 count) pairs over the trailing `days` — the raw material for the empirical rate-limit knee. */
export async function getHourlyRateLimitBuckets(days: number): Promise<HourlyRateLimitBucket[]> {
  const { rows } = await pool.query<{ calls: number; rate_limited: number }>(
    `SELECT COUNT(*)::int AS calls,
            COUNT(*) FILTER (WHERE error_code = 'HTTP_429')::int AS rate_limited
       FROM api_usage_log
      WHERE created_at >= NOW() - ($1 || ' days')::interval
        AND model LIKE 'deepseek:%'
      GROUP BY date_trunc('hour', created_at)`,
    [days]
  )
  return rows.map((r) => ({ calls: r.calls, rateLimited: r.rate_limited }))
}

export interface AccountSummary {
  account:            string
  totalCostUsd:       number
  callCount:          number
  balanceFailures:    number   // HTTP_402 count
  failureCount:       number   // any failure
  lastSuccessAt:      string | null
  lastFailureAt:      string | null
}

/** Per-DeepSeek-account cost/failure history over the trailing `days` — burn rate input for the balance ceiling, and the historical proxy for pool depth (live per-worker cooldown state isn't centrally queryable, see services/providerCeilings.ts). */
export async function getAccountSummaries(days: number): Promise<AccountSummary[]> {
  const { rows } = await pool.query<{
    account: string; total_cost_usd: number; call_count: number
    balance_failures: number; failure_count: number
    last_success_at: string | null; last_failure_at: string | null
  }>(
    `SELECT account,
            COALESCE(SUM(cost_usd), 0)::numeric AS total_cost_usd,
            COUNT(*)::int AS call_count,
            COUNT(*) FILTER (WHERE error_code = 'HTTP_402')::int AS balance_failures,
            COUNT(*) FILTER (WHERE NOT success)::int AS failure_count,
            MAX(created_at) FILTER (WHERE success)::text     AS last_success_at,
            MAX(created_at) FILTER (WHERE NOT success)::text AS last_failure_at
       FROM api_usage_log
      WHERE created_at >= NOW() - ($1 || ' days')::interval
        AND account IS NOT NULL
      GROUP BY account
      ORDER BY account`,
    [days]
  )
  return rows.map((r) => ({
    account: r.account, totalCostUsd: r.total_cost_usd, callCount: r.call_count,
    balanceFailures: r.balance_failures, failureCount: r.failure_count,
    lastSuccessAt: r.last_success_at, lastFailureAt: r.last_failure_at,
  }))
}
