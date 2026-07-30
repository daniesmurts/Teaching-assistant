import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../db/connection'
import { sampleOnce } from './resourceSampler'
import { getLatestResourceSample, getResourceSamplePeaks, pruneResourceSamples } from '../db/queries/resourceSamples'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('sampleOnce', () => {
  it('inserts a real sample with sane, non-zero measurements', async () => {
    await sampleOnce()
    const latest = await getLatestResourceSample()
    expect(latest).not.toBeNull()
    expect(latest!.rss_bytes).toBeGreaterThan(0)
    expect(latest!.db_size_bytes).toBeGreaterThan(0)
    expect(latest!.db_connections).toBeGreaterThanOrEqual(1)   // this test's own connection
    expect(latest!.embedded_assignments).toBeGreaterThanOrEqual(0)
  })

  it('does not throw when called back-to-back (idempotent-safe, not a singleton)', async () => {
    await sampleOnce()
    await sampleOnce()
    const peaks = await getResourceSamplePeaks(1)
    expect(peaks.sampleCount).toBeGreaterThanOrEqual(2)
  })
})

describe('getResourceSamplePeaks', () => {
  it('reports the PEAK, not the mean, across the samples in the window', async () => {
    // Insert two samples with very different db_connections readings directly,
    // bypassing the live measurement so the peak is deterministic.
    await pool.query(
      `INSERT INTO resource_samples (rss_bytes, heap_used_bytes, load_avg_1m, free_mem_bytes, db_size_bytes, db_connections, embedded_assignments)
       VALUES (1000,500,0.1,1000000,1000000,3,0), (1000,500,0.1,1000000,1000000,47,0)`
    )
    const peaks = await getResourceSamplePeaks(1)
    expect(peaks.peakDbConnections).toBe(47)   // not (3+47)/2
  })

  it('returns a zeroed result when there are no samples in the window', async () => {
    const peaks = await getResourceSamplePeaks(0.0001)   // an effectively-empty window
    expect(peaks.sampleCount).toBe(0)
    expect(peaks.peakDbConnections).toBe(0)
  })
})

describe('pruneResourceSamples', () => {
  it('deletes samples older than the retention window, keeps recent ones', async () => {
    await pool.query(
      `INSERT INTO resource_samples (sampled_at, rss_bytes, heap_used_bytes, load_avg_1m, free_mem_bytes, db_size_bytes, db_connections, embedded_assignments)
       VALUES (NOW() - INTERVAL '40 days', 1,1,0,1,1,1,0), (NOW(), 1,1,0,1,1,1,0)`
    )
    const deleted = await pruneResourceSamples(30)
    expect(deleted).toBe(1)
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM resource_samples')
    expect(rows[0].n).toBe(1)   // the recent one survives
  })
})
