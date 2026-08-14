import { pool } from '../connection'

// Raw queries behind services/schedulerLease.ts — see migration 112 for the
// design rationale (why a lease per tick rather than start-up leader election).

/**
 * Atomically claim `jobName` for `leaseMs`. Returns true iff THIS caller now
 * holds the lease.
 *
 * The whole decision is one statement on purpose. Two instances ticking at the
 * same moment both execute this INSERT: exactly one wins the primary-key
 * insert, and the loser's ON CONFLICT re-reads the row that just landed, finds
 * `expires_at` in the future, and its DO UPDATE ... WHERE is skipped — so it
 * gets no RETURNING row. A read-then-write version of this would race.
 *
 * `holder` is overwritten by whoever wins; it is diagnostic, never a
 * correctness input. Renewing your own lease is not special-cased — an
 * unexpired lease blocks everyone including its current holder, which is
 * exactly the "don't run again until the interval elapses" property the
 * schedulers need.
 */
export async function tryAcquireSchedulerLease(
  jobName: string,
  holder:  string,
  leaseMs: number,
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `INSERT INTO scheduler_leases AS l (job_name, holder, acquired_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + make_interval(secs => $3))
     ON CONFLICT (job_name) DO UPDATE
        SET holder      = EXCLUDED.holder,
            acquired_at = EXCLUDED.acquired_at,
            expires_at  = EXCLUDED.expires_at
      WHERE l.expires_at <= NOW()
     RETURNING l.job_name`,
    [jobName, holder, leaseMs / 1000]
  )
  return rowCount === 1
}

export interface SchedulerLeaseRow {
  job_name:    string
  holder:      string
  acquired_at: string
  expires_at:  string
}

/** Diagnostic read — "which instance last ran this job, and until when is it claimed?" */
export async function getSchedulerLease(jobName: string): Promise<SchedulerLeaseRow | null> {
  const { rows } = await pool.query<SchedulerLeaseRow>(
    `SELECT job_name, holder, acquired_at::text AS acquired_at, expires_at::text AS expires_at
       FROM scheduler_leases
      WHERE job_name = $1`,
    [jobName]
  )
  return rows[0] ?? null
}

/**
 * Expire a lease immediately. Not used by the schedulers themselves — holding
 * to expiry is the point (see migration 112) — but it makes the behaviour
 * testable without sleeping through a real interval, and gives an operator a
 * way to force a job to run on the next tick.
 */
export async function expireSchedulerLease(jobName: string): Promise<void> {
  await pool.query(`UPDATE scheduler_leases SET expires_at = NOW() - INTERVAL '1 second' WHERE job_name = $1`, [jobName])
}
