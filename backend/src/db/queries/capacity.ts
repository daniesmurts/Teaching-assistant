import { pool } from '../connection'

// TODO.md Feature AL Phase 2 — the physical measurements the headroom model
// (services/capacityModel.ts) divides by active-teacher count. Deliberately
// limited to what's honestly queryable from inside Postgres today:
//   * DB size and embedded-row count are direct SQL.
//   * pg_stat_activity gives CURRENT connection count, but "current ÷
//     active teachers this month" is a MEAN estimate, not a peak one — the
//     real ceiling-relevant number is concurrent connections at peak load,
//     which needs hourly bucketing this table doesn't have (Phase 3).
// Host-level disk/RAM percentage isn't queryable from SQL at all — that's
// Phase 4's in-process resource_samples sampler, not modeled here.

export async function getDatabaseSizeBytes(): Promise<number> {
  const { rows } = await pool.query<{ size: string }>(
    `SELECT pg_database_size(current_database())::text AS size`
  )
  return Number(rows[0]?.size ?? 0)
}

export async function getActiveConnectionCount(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM pg_stat_activity WHERE datname = current_database()`
  )
  return rows[0]?.count ?? 0
}

/** The pgvector reindex trigger metric — scaling.md's own threshold (lists=100 heuristic degrades past ~50,000 rows). */
export async function getEmbeddedAssignmentCount(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM assignments WHERE embedding IS NOT NULL`
  )
  return rows[0]?.count ?? 0
}
