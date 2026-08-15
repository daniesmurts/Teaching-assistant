import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../../db/connection'
import { buildEnvelope } from './buildEnvelope'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('buildEnvelope', () => {
  it('assembles a well-formed envelope against a real (test) database, with no job queue started', async () => {
    // The integration harness never calls startJobQueue() — this is exactly
    // the "pg-boss not ready" case getQueueDepth() must degrade gracefully
    // for, not throw on. If this ever regresses back to a hard throw, EVERY
    // heartbeat tick fails the moment pg-boss has any hiccup, not just this test.
    const envelope = await buildEnvelope({ incidentsWindowMs: 15 * 60 * 1000 })

    expect(envelope.platform.appVersion).toBeTypeOf('string')
    expect(envelope.platform.schemaVersion).toMatch(/\.sql$/)
    expect(envelope.platform.uptimeSeconds).toBeGreaterThanOrEqual(0)

    expect(envelope.health.dbOk).toBe(true)
    expect(envelope.health.queueDepth).toBe(0)   // degraded-but-not-thrown, per the comment above

    expect(Array.isArray(envelope.models)).toBe(true)
    expect(Array.isArray(envelope.usage)).toBe(true)
    expect(Array.isArray(envelope.incidents)).toBe(true)
    expect(envelope.seats.active).toBeGreaterThanOrEqual(0)
    expect(envelope.seats.licensed).toBeNull()
  })
})
