// Covers the primitive that replaced the PM2 `NODE_APP_INSTANCE` worker-0
// gate (docs/on-prem-deployment.md §16 Track 1.4, migration 112). The
// property under test is the one that matters for payments: when several API
// instances tick at the same moment, exactly ONE runs the job.

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../db/connection'
import { runWithLease, INSTANCE_ID } from './schedulerLease'
import {
  tryAcquireSchedulerLease, getSchedulerLease, expireSchedulerLease,
} from '../db/queries/schedulerLeases'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('tryAcquireSchedulerLease', () => {
  it('grants the lease to the first caller and refuses everyone else until it expires', async () => {
    const job = `test_job_${Date.now()}`

    expect(await tryAcquireSchedulerLease(job, 'instance-a', 60_000)).toBe(true)
    // This is the double-charge guard: a second instance ticking in the same
    // window must not get the lease.
    expect(await tryAcquireSchedulerLease(job, 'instance-b', 60_000)).toBe(false)
    // Not even the current holder — an unexpired lease means "this job already
    // ran for this interval", regardless of who asks.
    expect(await tryAcquireSchedulerLease(job, 'instance-a', 60_000)).toBe(false)

    const lease = await getSchedulerLease(job)
    expect(lease!.holder).toBe('instance-a')
  })

  it('hands the lease to a different instance once it expires — failover without a restart', async () => {
    const job = `test_job_${Date.now()}`
    expect(await tryAcquireSchedulerLease(job, 'instance-a', 60_000)).toBe(true)

    // Simulates both "the interval elapsed" and "the holder died mid-tick":
    // either way the lease lapses and the next tick anywhere picks the work up.
    await expireSchedulerLease(job)

    expect(await tryAcquireSchedulerLease(job, 'instance-b', 60_000)).toBe(true)
    const lease = await getSchedulerLease(job)
    expect(lease!.holder).toBe('instance-b')
  })

  it('yields exactly one winner when many callers claim the same job', async () => {
    // CAVEAT: the integration suite pins DB_POOL_MAX=1 and wraps each test in a
    // transaction, so these 8 calls serialise on one connection — this proves
    // the exactly-one-winner LOGIC, not a true cross-connection race. Real
    // cross-process atomicity comes from the claim being a single INSERT ...
    // ON CONFLICT ... WHERE statement (see db/queries/schedulerLeases.ts);
    // that is the part a read-then-write implementation would get wrong.
    const job = `test_job_${Date.now()}`
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => tryAcquireSchedulerLease(job, `instance-${i}`, 60_000))
    )
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})

describe('runWithLease', () => {
  it('runs the job when it wins the lease, and skips it when another instance holds one', async () => {
    const job = `test_job_${Date.now()}`
    let runs = 0

    expect(await runWithLease(job, 60_000, async () => { runs++ })).toBe(true)
    expect(runs).toBe(1)

    expect(await runWithLease(job, 60_000, async () => { runs++ })).toBe(false)
    expect(runs).toBe(1)

    expect((await getSchedulerLease(job))!.holder).toBe(INSTANCE_ID)
  })

  it('holds the lease after the job finishes, so the next tick inside the interval is still skipped', async () => {
    // The lease is deliberately never released on completion — holding it to
    // expiry is what enforces "once per interval" (migration 112).
    const job = `test_job_${Date.now()}`
    await runWithLease(job, 60_000, async () => { /* completes immediately */ })

    const lease = await getSchedulerLease(job)
    expect(new Date(lease!.expires_at).getTime()).toBeGreaterThan(Date.now())
  })

  it('swallows a throwing job and keeps the lease, so a broken job cannot hot-loop the cluster', async () => {
    const job = `test_job_${Date.now()}`

    // Must not reject — a scheduler tick that throws would otherwise surface as
    // an unhandled rejection and could take the process down.
    await expect(runWithLease(job, 60_000, async () => { throw new Error('boom') })).resolves.toBe(true)

    // Lease retained despite the failure: another instance must not immediately
    // retry and turn one broken job into a tight loop across every replica.
    expect(await tryAcquireSchedulerLease(job, 'instance-b', 60_000)).toBe(false)
  })
})
