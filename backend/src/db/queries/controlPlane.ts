import { pool } from '../connection'
import type { TelemetryEnvelope, UsageRow, IncidentCount } from '../../services/controlPlane/envelope'

export interface DeploymentSummaryRow {
  id:                 string
  name:               string
  mode:               string
  expected_connectivity: string
  current_version:    string | null
  first_seen_at:      string | null
  last_heartbeat_at:  string | null
  active_seats:       number | null
  db_ok:              boolean | null
  queue_depth:        number | null
  uptime_seconds:      number | null
  errors_24h:         number
}

/**
 * One row per deployment — Track 1.7's fleet overview (§5.4). Pulls the
 * seats/health snapshot from whichever heartbeat is MOST RECENT for that
 * deployment (a lateral join, not a second round trip), straight out of the
 * envelope JSONB rather than a separate summary table — there's nothing to
 * keep in sync that way. `connectivity` (live/stale/offline, §5.5) is
 * deliberately NOT computed here — it depends on "now" at render time, not
 * at query time, so the caller derives it from `last_heartbeat_at`.
 */
export async function listDeploymentsSummary(): Promise<DeploymentSummaryRow[]> {
  const { rows } = await pool.query<DeploymentSummaryRow>(
    `SELECT
       d.id, d.name, d.mode, d.expected_connectivity,
       d.current_version, d.first_seen_at, d.last_heartbeat_at,
       (h.envelope -> 'seats' ->> 'active')::int          AS active_seats,
       (h.envelope -> 'health' ->> 'dbOk')::boolean        AS db_ok,
       (h.envelope -> 'health' ->> 'queueDepth')::int      AS queue_depth,
       (h.envelope -> 'platform' ->> 'uptimeSeconds')::int AS uptime_seconds,
       COALESCE(e.errors_24h, 0)                           AS errors_24h
     FROM deployments d
     LEFT JOIN LATERAL (
       SELECT envelope FROM deployment_heartbeats
        WHERE deployment_id = d.id
        ORDER BY received_at DESC
        LIMIT 1
     ) h ON true
     LEFT JOIN LATERAL (
       SELECT SUM(count)::int AS errors_24h
         FROM deployment_incidents
        WHERE deployment_id = d.id AND window_end > NOW() - INTERVAL '24 hours'
     ) e ON true
     ORDER BY d.first_seen_at ASC NULLS LAST, d.name`
  )
  return rows
}

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
