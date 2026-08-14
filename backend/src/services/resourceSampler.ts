// TODO.md Feature AL Phase 4 — the in-process resource sampler. Captures
// what Yandex Cloud Monitoring can't see (DB pool exhaustion, pgvector row
// counts) and what nothing else in ИСПУМ tracks at all (process RAM usage)
// — deliberately NOT the host's disk/RAM %, which isn't queryable from
// inside Node/Postgres; that stays a Yandex-console-only number.

import os from 'os'
import { logger } from '../lib/logger'
import { scheduleWithLease } from './schedulerLease'
import { getDatabaseSizeBytes, getActiveConnectionCount, getEmbeddedAssignmentCount } from '../db/queries/capacity'
import { insertResourceSample, pruneResourceSamples } from '../db/queries/resourceSamples'

const RETENTION_DAYS = 30
const SAMPLE_INTERVAL_MS = 60 * 1000

/** One measurement + insert. Exported standalone so it's testable and callable outside the interval loop. */
export async function sampleOnce(): Promise<void> {
  const mem = process.memoryUsage()
  const [dbSizeBytes, dbConnections, embeddedAssignments] = await Promise.all([
    getDatabaseSizeBytes(), getActiveConnectionCount(), getEmbeddedAssignmentCount(),
  ])

  await insertResourceSample({
    rssBytes:            mem.rss,
    heapUsedBytes:        mem.heapUsed,
    loadAvg1m:           os.loadavg()[0],
    freeMemBytes:        os.freemem(),
    dbSizeBytes, dbConnections, embeddedAssignments,
  })
  await pruneResourceSamples(RETENTION_DAYS)
}

async function tick(): Promise<void> {
  try {
    await sampleOnce()
  } catch (err) {
    // A failed sample must never crash the process — same fail-open
    // posture as every other background sampler/scheduler in this codebase.
    logger.warn({ message: '[ResourceSampler] Sample failed', error: (err as Error).message })
  }
}

/** Start the ~60s sampler. Gated to PM2 worker 0 only — same precedent as services/renewals.ts's startRenewalScheduler — so cluster mode doesn't insert duplicate samples every tick. */
export function startResourceSampler(): void {
  // Lease-gated so exactly one instance samples per tick — see
  // services/schedulerLease.ts. Semantic nuance worth knowing when reading the
  // numbers: the RSS/heap figures now come from whichever instance won this
  // tick, not always from PM2's worker 0. Both are "one worker's memory", so
  // the capacity signal is unchanged, but consecutive samples may come from
  // different processes.
  scheduleWithLease('resource_sampler', { intervalMs: SAMPLE_INTERVAL_MS, leaseMs: SAMPLE_INTERVAL_MS - 10_000, firstRunDelayMs: 0 },
    async () => { await tick() })
  logger.info({ message: 'Resource sampler started', intervalMs: SAMPLE_INTERVAL_MS, retentionDays: RETENTION_DAYS })
}
