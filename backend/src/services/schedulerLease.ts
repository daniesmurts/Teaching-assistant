// Cluster-safe scheduling primitive — docs/on-prem-deployment.md §16 Track 1.4.
//
// Every API instance runs every timer. Each tick races for a short Postgres
// lease on the job name, and only the winner executes. This replaces the
// `NODE_APP_INSTANCE !== '0'` gate, which depended on PM2 setting that
// variable and therefore silently degraded to "every replica is worker 0" in
// a container — double-firing renewals and payment reconciliation.
//
// See migration 112 for why a per-tick lease rather than start-up leader
// election, and why the lease is never released early.

import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import { tryAcquireSchedulerLease } from '../db/queries/schedulerLeases'
import { logger } from '../lib/logger'

/**
 * Opaque per-process identity, stable for the process's lifetime. Diagnostic
 * only — it answers "which instance has been running the crons?" in the
 * scheduler_leases table and in logs. Correctness never depends on it, so the
 * random suffix (rather than something like a container id) is fine and keeps
 * two processes on one host distinguishable.
 */
export const INSTANCE_ID = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`

/**
 * Run `fn` iff this instance wins the lease for `jobName`. Returns whether it ran.
 *
 * Fail-open on lease-acquisition errors: if the database is unreachable we log
 * and skip this tick rather than throw. Same posture as every other background
 * sampler here — a scheduler must never take the process down, and the next
 * tick retries anyway.
 */
export async function runWithLease(
  jobName: string,
  leaseMs: number,
  fn:      () => Promise<void>,
): Promise<boolean> {
  let acquired: boolean
  try {
    acquired = await tryAcquireSchedulerLease(jobName, INSTANCE_ID, leaseMs)
  } catch (err) {
    logger.warn({ message: 'Scheduler lease acquisition failed — skipping tick', jobName, error: (err as Error).message })
    return false
  }

  if (!acquired) return false

  try {
    await fn()
  } catch (err) {
    // The lease is intentionally NOT expired here. A job that throws every run
    // would otherwise be retried by a different instance immediately, turning
    // one broken job into a hot loop across the cluster.
    logger.warn({ message: 'Scheduled job failed', jobName, error: (err as Error).message })
  }
  return true
}

export interface LeaseScheduleOptions {
  /** How often every instance ticks. */
  intervalMs: number
  /**
   * How long the winner blocks other instances. MUST be shorter than
   * intervalMs or ticks get skipped; long enough to outlast a slow run, or two
   * instances could overlap on the same job. Defaults to 80% of the interval.
   */
  leaseMs?: number
  /**
   * Schedule an EXTRA early tick this many ms after boot, on top of the
   * recurring interval (which always starts at boot regardless). Omit for
   * "first run one full interval from now" — the plain `setInterval` shape.
   * Pass 0 for "run immediately at boot".
   */
  firstRunDelayMs?: number
}

/**
 * Start a cluster-safe recurring job. Drop-in replacement for the
 * `setTimeout` + `setInterval` + worker-0-gate shape the schedulers used.
 */
export function scheduleWithLease(
  jobName: string,
  opts:    LeaseScheduleOptions,
  fn:      () => Promise<void>,
): void {
  const { intervalMs, leaseMs = Math.floor(intervalMs * 0.8), firstRunDelayMs } = opts

  if (leaseMs >= intervalMs) {
    // Not fatal, but it means some ticks will find the lease still held and
    // silently skip — worth shouting about rather than debugging later.
    logger.warn({ message: 'Scheduler lease is not shorter than its interval — ticks will be skipped', jobName, intervalMs, leaseMs })
  }

  const tick = (): void => { void runWithLease(jobName, leaseMs, fn) }

  if (firstRunDelayMs !== undefined) setTimeout(tick, firstRunDelayMs)
  setInterval(tick, intervalMs)
}
