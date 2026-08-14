import { pool } from '../connection'

// TODO.md Feature AL Phase 4 — raw queries behind services/resourceSampler.ts.

export interface InsertResourceSampleParams {
  rssBytes:            number
  heapUsedBytes:       number
  loadAvg1m:           number
  freeMemBytes:        number
  dbSizeBytes:         number
  dbConnections:       number
  embeddedAssignments: number
}

export async function insertResourceSample(p: InsertResourceSampleParams): Promise<void> {
  await pool.query(
    `INSERT INTO resource_samples
       (rss_bytes, heap_used_bytes, load_avg_1m, free_mem_bytes, db_size_bytes, db_connections, embedded_assignments)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [p.rssBytes, p.heapUsedBytes, p.loadAvg1m, p.freeMemBytes, p.dbSizeBytes, p.dbConnections, p.embeddedAssignments]
  )
}

/** Prunes samples older than `days` — keeps the table from growing unbounded. Called on every sampler tick (cheap indexed range delete). */
export async function pruneResourceSamples(days: number): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM resource_samples WHERE sampled_at < NOW() - ($1 || ' days')::interval`,
    [days]
  )
  return rowCount ?? 0
}

export interface ResourceSampleRow {
  sampled_at:           string
  rss_bytes:            number
  heap_used_bytes:      number
  load_avg_1m:           number
  free_mem_bytes:       number
  db_size_bytes:        number
  db_connections:       number
  embedded_assignments: number
}

export async function getLatestResourceSample(): Promise<ResourceSampleRow | null> {
  const { rows } = await pool.query<ResourceSampleRow>(
    // float8, NOT int — these columns are BIGINT because they hold byte
    // counts, and `::int` is int4 (max 2,147,483,647 ≈ 2.0 GiB), so the cast
    // throws "integer out of range" the moment any of them exceeds ~2.1 GB.
    // free_mem_bytes (os.freemem()) crosses that on any machine with more
    // than 2 GB free, which is every production VM in normal operation —
    // this threw in CI on a 16 GB runner while passing on macOS, where
    // freemem() reports a much smaller number because the OS holds memory as
    // cache. float8 is exact for integers below 2^53 (~9 PB), and node-pg
    // parses it straight to a JS number, unlike bigint which arrives as a
    // string. The `number` typings above stay honest.
    `SELECT sampled_at::text AS sampled_at,
            rss_bytes::float8 AS rss_bytes, heap_used_bytes::float8 AS heap_used_bytes,
            load_avg_1m, free_mem_bytes::float8 AS free_mem_bytes,
            db_size_bytes::float8 AS db_size_bytes, db_connections, embedded_assignments
       FROM resource_samples
      ORDER BY sampled_at DESC
      LIMIT 1`
  )
  return rows[0] ?? null
}

export interface ResourceSamplePeaks {
  sampleCount:      number
  peakRssBytes:     number
  peakLoadAvg1m:    number
  peakDbConnections: number
  peakDbSizeBytes:  number
}

/** Peak (not mean) values over the trailing `hours` — the whole point of sampling is catching the worst moment, not smoothing over it. */
export async function getResourceSamplePeaks(hours: number): Promise<ResourceSamplePeaks> {
  const { rows } = await pool.query<{
    sample_count: number; peak_rss: number; peak_load: number; peak_conn: number; peak_db_size: number
  }>(
    // Byte peaks are float8 for the same int4-overflow reason as
    // getLatestResourceSample above. sample_count and peak_conn stay ::int —
    // a row count and a connection count can't approach 2.1 billion.
    `SELECT COUNT(*)::int AS sample_count,
            COALESCE(MAX(rss_bytes), 0)::float8 AS peak_rss,
            COALESCE(MAX(load_avg_1m), 0) AS peak_load,
            COALESCE(MAX(db_connections), 0)::int AS peak_conn,
            COALESCE(MAX(db_size_bytes), 0)::float8 AS peak_db_size
       FROM resource_samples
      WHERE sampled_at >= NOW() - ($1 || ' hours')::interval`,
    [hours]
  )
  const r = rows[0]
  return {
    sampleCount: r?.sample_count ?? 0,
    peakRssBytes: r?.peak_rss ?? 0,
    peakLoadAvg1m: r?.peak_load ?? 0,
    peakDbConnections: r?.peak_conn ?? 0,
    peakDbSizeBytes: r?.peak_db_size ?? 0,
  }
}
