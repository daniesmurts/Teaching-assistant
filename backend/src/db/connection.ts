import { Pool, types } from 'pg'
import { logger } from '../lib/logger'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL environment variable is required')
}

// pg returns NUMERIC/DECIMAL (OID 1700) as strings by default, to avoid
// silent float precision loss on values the driver can't know the intended
// use of. Every NUMERIC column in this schema (spend caps, costs, credits,
// confidence stats) is consumed as a JS number downstream, so parse it here
// once rather than casting at every call site.
types.setTypeParser(1700, (value: string) => parseFloat(value))

// Pool sizing — tuned for a 2-instance PM2 cluster on a 2GB VM where Postgres
// allows ~100 connections by default. 25 per Node worker × 2 workers = 50 max
// (still leaves headroom for psql sessions, the renewals scheduler, migrations).
// Override DB_POOL_MAX in .env if you bump the VM or scale workers.
export const pool = new Pool({
  connectionString:        process.env.DATABASE_URL,
  max:                     Number(process.env.DB_POOL_MAX ?? 25),
  idleTimeoutMillis:       30_000,
  connectionTimeoutMillis: 5_000,
  // Client-side kill switch: any query running >90s is aborted. Long reviews
  // are async (job-poll), so no real handler needs longer than this.
  query_timeout:           90_000,
})

pool.on('error', (err) => {
  logger.error({ message: 'Unexpected PostgreSQL pool error', error: err.message })
})
