// Postgres-backed durable job queue (TODO.md Improvement #1) — pg-boss on the
// existing database, no new infra. Fixes: `runLongReview` used to run
// fire-and-forget inside the Express process, so a PM2 restart mid-review
// silently orphaned the work (the job just hung at whatever status it was
// last at, forever). Enqueuing here persists the job as a Postgres row
// *before* the HTTP response is sent — a worker crash mid-job means pg-boss's
// own expiration + retry policy picks it back up, with a dead-letter queue
// after retries are exhausted, instead of losing it silently.
//
// pg-boss manages its own schema (`pgboss` by default) via internal
// migrations run inside start() — no migration file of ours needed for it.
//
// Same machinery is meant to power bulk grading (TODO Feature A) later; kept
// deliberately generic (register any named queue) rather than long-review-
// specific, but only registers what's actually used today.
//
// v10.x pinned (not the current v12) — v12 is ESM-only and this backend
// compiles to CommonJS (tsc, `module: "CommonJS"`); v10 is CommonJS and
// requires Node >=20, matching production's NodeSource 20.x provisioning
// (vm-setup.sh) exactly.
//
// Workers run in every PM2 cluster process independently — unlike the daily
// renewal scheduler (which gates on NODE_APP_INSTANCE to avoid double-firing
// a cron), pg-boss's SKIP LOCKED polling is safe and intended to run from
// multiple processes: whichever worker polls first claims the job.

import PgBoss from 'pg-boss'
import { logger } from '../lib/logger'
import { config } from '../lib/config'

let boss: PgBoss | null = null

export async function startJobQueue(): Promise<PgBoss> {
  if (boss) return boss

  const instance = new PgBoss({
    connectionString: config.db.url,
    // Keep pg-boss's own connection pool small — it polls, it doesn't need
    // the app's request-serving headroom (see db/connection.ts's DB_POOL_MAX
    // budgeting comment; this must not eat into that ceiling).
    max: 4,
  })
  instance.on('error', (err) => logger.error({ message: 'pg-boss error', error: err.message }))

  await instance.start()
  boss = instance
  logger.info({ message: 'Job queue started' })
  return boss
}

export function getJobQueue(): PgBoss {
  if (!boss) throw new Error('Job queue not started — call startJobQueue() at boot before use')
  return boss
}

export async function stopJobQueue(): Promise<void> {
  if (!boss) return
  await boss.stop({ graceful: true, timeout: 30_000 })
  boss = null
}
