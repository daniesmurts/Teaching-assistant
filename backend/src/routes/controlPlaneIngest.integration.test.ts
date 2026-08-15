// HTTP-level coverage for the control-plane ingest route
// (docs/on-prem-deployment.md §16 Track 1.6). The trust boundary this route
// exists to enforce — an envelope is only ever accepted if it verifies
// against the SPECIFIC deployment it claims to be from — is what these
// tests are actually checking, not just "does it return 201".
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import { app } from '../app'
import { pool } from '../db/connection'
import { signEnvelope } from '../services/controlPlane/signing'
import type { TelemetryEnvelope } from '../services/controlPlane/envelope'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const SAMPLE_ENVELOPE: TelemetryEnvelope = {
  platform: { appVersion: '1.5.0 (test)', schemaVersion: '113_control_plane.sql', uptimeSeconds: 120 },
  health:   { dbOk: true, queueDepth: 0 },
  models:   [],
  usage:    [{
    month: '2026-08', institutionId: '11111111-1111-1111-1111-111111111111',
    activeSeats: 3, seatsPurchased: null, overheadCallCount: 0, overheadTokens: 0,
    overheadCostUsd: 0, amortizedRevenueRub: null, amortizedRevenueUsd: null,
  }],
  seats:     { active: 5, licensed: null },
  incidents: [{ code: 'TEST_CODE', count: 2, windowStart: new Date().toISOString(), windowEnd: new Date().toISOString() }],
}

async function registerTestDeployment(): Promise<{ deploymentId: string; privateKeyPem: string }> {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
  const privateKeyPem = await exportPKCS8(privateKey)
  const publicKeyPem  = await exportSPKI(publicKey)

  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO deployments (name, public_key) VALUES ('Test Deployment', $1) RETURNING id`,
    [publicKeyPem]
  )
  return { deploymentId: rows[0].id, privateKeyPem }
}

describe('POST /api/control-plane/ingest', () => {
  it('accepts a validly signed envelope and persists heartbeat + summary + usage + incidents', async () => {
    const { deploymentId, privateKeyPem } = await registerTestDeployment()
    const jws = await signEnvelope(deploymentId, SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')

    const res = await request(app).post('/api/control-plane/ingest').send({ jws })
    expect(res.status).toBe(201)

    const heartbeat = await pool.query('SELECT envelope FROM deployment_heartbeats WHERE deployment_id = $1', [deploymentId])
    expect(heartbeat.rows).toHaveLength(1)
    expect(heartbeat.rows[0].envelope.platform.appVersion).toBe('1.5.0 (test)')

    const deployment = await pool.query(
      'SELECT current_version, last_heartbeat_at, first_seen_at FROM deployments WHERE id = $1', [deploymentId]
    )
    expect(deployment.rows[0].current_version).toBe('1.5.0 (test)')
    expect(deployment.rows[0].last_heartbeat_at).not.toBeNull()
    expect(deployment.rows[0].first_seen_at).not.toBeNull()

    const usage = await pool.query('SELECT active_seats FROM deployment_usage_monthly WHERE deployment_id = $1', [deploymentId])
    expect(usage.rows).toHaveLength(1)
    expect(usage.rows[0].active_seats).toBe(3)

    const incidents = await pool.query('SELECT code, count FROM deployment_incidents WHERE deployment_id = $1', [deploymentId])
    expect(incidents.rows).toHaveLength(1)
    expect(incidents.rows[0]).toMatchObject({ code: 'TEST_CODE', count: 2 })
  })

  it('a resent usage row for the same (deployment, month, institution) upserts, not duplicates', async () => {
    const { deploymentId, privateKeyPem } = await registerTestDeployment()
    const jws1 = await signEnvelope(deploymentId, SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')
    await request(app).post('/api/control-plane/ingest').send({ jws: jws1 })

    const updated: TelemetryEnvelope = {
      ...SAMPLE_ENVELOPE,
      usage: [{ ...SAMPLE_ENVELOPE.usage[0], activeSeats: 9 }],
    }
    const jws2 = await signEnvelope(deploymentId, updated, privateKeyPem, '1.5.0')
    const res2 = await request(app).post('/api/control-plane/ingest').send({ jws: jws2 })
    expect(res2.status).toBe(201)

    const usage = await pool.query('SELECT active_seats FROM deployment_usage_monthly WHERE deployment_id = $1', [deploymentId])
    expect(usage.rows).toHaveLength(1)
    expect(usage.rows[0].active_seats).toBe(9)
  })

  it('REGRESSION: rejects an envelope signed for a deployment id that does not exist', async () => {
    const { privateKeyPem } = await registerTestDeployment()   // has a real key, but we sign as a fake id
    const jws = await signEnvelope('00000000-0000-0000-0000-000000000099', SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')

    const res = await request(app).post('/api/control-plane/ingest').send({ jws })
    expect(res.status).toBe(401)

    const heartbeats = await pool.query('SELECT COUNT(*)::int AS n FROM deployment_heartbeats')
    expect(heartbeats.rows[0].n).toBe(0)
  })

  it('REGRESSION: rejects an envelope claiming to be deployment A but signed with deployment B\'s key', async () => {
    const a = await registerTestDeployment()
    const b = await registerTestDeployment()
    // Signs with B's private key but sets sub = A's id — the attack this
    // route exists to prevent: forging telemetry as someone else.
    const forged = await signEnvelope(a.deploymentId, SAMPLE_ENVELOPE, b.privateKeyPem, '1.5.0')

    const res = await request(app).post('/api/control-plane/ingest').send({ jws: forged })
    expect(res.status).toBe(401)

    const heartbeats = await pool.query('SELECT COUNT(*)::int AS n FROM deployment_heartbeats WHERE deployment_id = $1', [a.deploymentId])
    expect(heartbeats.rows[0].n).toBe(0)
  })

  it('rejects malformed input without a jws field', async () => {
    const res = await request(app).post('/api/control-plane/ingest').send({ notAJws: true })
    expect(res.status).toBe(400)
  })

  it('rejects a deployment with no public_key on file, even with a real signature', async () => {
    const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
    const privateKeyPem = await exportPKCS8(privateKey)
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO deployments (name, public_key) VALUES ('Keyless Deployment', NULL) RETURNING id`
    )
    const jws = await signEnvelope(rows[0].id, SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')

    const res = await request(app).post('/api/control-plane/ingest').send({ jws })
    expect(res.status).toBe(401)
  })
})
