import { pool } from '../connection'
import type { TelemetryEnvelope, UsageRow, IncidentCount } from '../../services/controlPlane/envelope'

/** Grouped incident counts for the outbound envelope — code only, never `message` (§5.2's aggregates-only rule). */
export async function getIncidentCountsSince(windowStart: Date, windowEnd: Date): Promise<IncidentCount[]> {
  const { rows } = await pool.query<{ code: string; count: number }>(
    `SELECT code, COUNT(*)::int AS count
       FROM production_incidents
      WHERE created_at >= $1 AND created_at < $2
      GROUP BY code
      ORDER BY count DESC`,
    [windowStart, windowEnd]
  )
  return rows.map((r) => ({
    code:        r.code,
    count:       r.count,
    windowStart: windowStart.toISOString(),
    windowEnd:   windowEnd.toISOString(),
  }))
}

/**
 * NULL for both "no such deployment" and "deployment exists but has no key
 * on file yet" — the ingest route treats both as a rejection. Deployments
 * are provisioned deliberately (a row inserted by hand or by a future admin
 * flow); an unrecognized deployment_id in an incoming envelope is never
 * silently registered — that would let anyone spam-create fake fleet entries.
 */
export async function getDeploymentPublicKey(deploymentId: string): Promise<string | null> {
  const { rows } = await pool.query<{ public_key: string | null }>(
    `SELECT public_key FROM deployments WHERE id = $1`,
    [deploymentId]
  )
  return rows[0]?.public_key ?? null
}

export async function insertHeartbeat(deploymentId: string, envelope: TelemetryEnvelope): Promise<void> {
  await pool.query(
    `INSERT INTO deployment_heartbeats (deployment_id, envelope) VALUES ($1, $2)`,
    [deploymentId, JSON.stringify(envelope)]
  )
}

/**
 * Updates the deployment's own summary row. `first_seen_at` is set once, on
 * whichever heartbeat happens to be first — COALESCE makes this idempotent
 * against re-ordering (a retried/delayed envelope) without needing a
 * separate "is this the first ever" check.
 */
export async function touchDeployment(deploymentId: string, appVersion: string): Promise<void> {
  await pool.query(
    `UPDATE deployments
        SET last_heartbeat_at = NOW(),
            current_version   = $2,
            first_seen_at     = COALESCE(first_seen_at, NOW())
      WHERE id = $1`,
    [deploymentId, appVersion]
  )
}

/** Upserts by (deployment_id, month, institution_id) — a resent/corrected rollup overwrites, not duplicates. */
export async function upsertUsageMonthly(deploymentId: string, rows: UsageRow[]): Promise<void> {
  for (const r of rows) {
    await pool.query(
      `INSERT INTO deployment_usage_monthly
         (deployment_id, month, institution_id, active_seats, seats_purchased,
          overhead_call_count, overhead_tokens, overhead_cost_usd,
          amortized_revenue_rub, amortized_revenue_usd)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (deployment_id, month, institution_id) DO UPDATE
          SET active_seats          = EXCLUDED.active_seats,
              seats_purchased       = EXCLUDED.seats_purchased,
              overhead_call_count   = EXCLUDED.overhead_call_count,
              overhead_tokens       = EXCLUDED.overhead_tokens,
              overhead_cost_usd     = EXCLUDED.overhead_cost_usd,
              amortized_revenue_rub = EXCLUDED.amortized_revenue_rub,
              amortized_revenue_usd = EXCLUDED.amortized_revenue_usd,
              received_at           = NOW()`,
      [
        deploymentId, r.month, r.institutionId, r.activeSeats, r.seatsPurchased,
        r.overheadCallCount, r.overheadTokens, r.overheadCostUsd,
        r.amortizedRevenueRub, r.amortizedRevenueUsd,
      ]
    )
  }
}

/**
 * Plain inserts, not upserts — each heartbeat's incident counts cover a
 * fresh reporting window (see agent.ts), so there's no natural conflict key
 * to upsert against; re-sending the same window twice just adds a second
 * count row for it, same as deployment_heartbeats' own append-only design.
 */
export async function insertIncidents(deploymentId: string, appVersion: string, incidents: IncidentCount[]): Promise<void> {
  for (const inc of incidents) {
    await pool.query(
      `INSERT INTO deployment_incidents (deployment_id, app_version, code, count, window_start, window_end)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [deploymentId, appVersion, inc.code, inc.count, inc.windowStart, inc.windowEnd]
    )
  }
}
