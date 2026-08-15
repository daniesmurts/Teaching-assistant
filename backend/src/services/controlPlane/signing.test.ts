import { describe, it, expect, beforeAll } from 'vitest'
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'
import { signEnvelope, verifyEnvelope, decodeDeploymentId } from './signing'
import type { TelemetryEnvelope } from './envelope'

const SAMPLE_ENVELOPE: TelemetryEnvelope = {
  platform: { appVersion: '1.5.0 (2026-08-15+abc1234)', schemaVersion: '113_control_plane.sql', uptimeSeconds: 3600 },
  health:   { dbOk: true, queueDepth: 0 },
  models:   [{ provider: 'deepseek', modelId: 'deepseek-v4-flash', calls24h: 42, errorRate: 0 }],
  usage:    [],
  seats:    { active: 10, licensed: null },
  incidents: [],
}

describe('control-plane envelope signing', () => {
  let privateKeyPem: string
  let publicKeyPem: string
  let otherPublicKeyPem: string

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
    privateKeyPem = await exportPKCS8(pair.privateKey)
    publicKeyPem  = await exportSPKI(pair.publicKey)

    const otherPair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
    otherPublicKeyPem = await exportSPKI(otherPair.publicKey)
  })

  it('round-trips: signed with one key, verifies with its matching public key', async () => {
    const jws = await signEnvelope('deployment-a', SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')
    const verified = await verifyEnvelope(jws, publicKeyPem)

    expect(verified.deploymentId).toBe('deployment-a')
    expect(verified.agentVersion).toBe('1.5.0')
    expect(verified.envelope).toEqual(SAMPLE_ENVELOPE)
    expect(verified.sentAt).toBeInstanceOf(Date)
  })

  it('REGRESSION: one deployment cannot forge another — verification fails against the wrong public key', async () => {
    const jws = await signEnvelope('deployment-a', SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')
    await expect(verifyEnvelope(jws, otherPublicKeyPem)).rejects.toThrow()
  })

  it('rejects a tampered token (any byte change invalidates the RS256 signature)', async () => {
    const jws = await signEnvelope('deployment-a', SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')
    const tampered = jws.slice(0, -4) + 'XXXX'
    await expect(verifyEnvelope(tampered, publicKeyPem)).rejects.toThrow()
  })

  it('decodeDeploymentId reads `sub` without needing the key — used only to route to the right key', async () => {
    const jws = await signEnvelope('deployment-b', SAMPLE_ENVELOPE, privateKeyPem, '1.5.0')
    expect(decodeDeploymentId(jws)).toBe('deployment-b')
  })

  it('decodeDeploymentId throws on a garbage token rather than crashing', () => {
    expect(() => decodeDeploymentId('not-a-jwt')).toThrow()
  })
})
