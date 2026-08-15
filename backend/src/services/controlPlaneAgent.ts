// Control-plane heartbeat agent — docs/on-prem-deployment.md §16 Track 1.6.
// Builds an envelope, signs it with this deployment's own private key, and
// POSTs it to the control-plane ingest endpoint. Phase 1: our own cloud
// posts to ITSELF over localhost (controlPlane.url defaults there) — proves
// sign → ingest → verify → store end to end with zero on-prem risk, before
// any real remote deployment exists (§11 Phase 1).
//
// Cluster-safe via the Track 1.4a lease (services/schedulerLease.ts) — with
// a second replica later, only one instance sends a given tick's heartbeat.

import { config } from '../lib/config'
import { logger } from '../lib/logger'
import { getBuildVersion } from '../lib/version'
import { scheduleWithLease } from './schedulerLease'
import { buildEnvelope } from './controlPlane/buildEnvelope'
import { signEnvelope } from './controlPlane/signing'

const INTERVAL_MS = 15 * 60 * 1000   // 15 minutes — tunable; not load-bearing on anything yet

function ingestUrl(): string {
  const base = config.controlPlane.url || `http://127.0.0.1:${config.port}`
  return `${base}/api/control-plane/ingest`
}

async function sendHeartbeat(): Promise<void> {
  // Guarded again here even though startControlPlaneAgent() already checks
  // this before scheduling — the lease's own error handling (below) would
  // otherwise just log the same "not set" failure every 15 minutes forever.
  if (!config.controlPlane.privateKey) return

  const envelope = await buildEnvelope({ incidentsWindowMs: INTERVAL_MS })
  const jws = await signEnvelope(
    config.controlPlane.deploymentId,
    envelope,
    config.controlPlane.privateKey,
    getBuildVersion(),
  )

  const response = await fetch(ingestUrl(), {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ jws }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Control-plane ingest returned ${response.status}: ${body}`)
  }

  logger.info({ message: 'Control-plane heartbeat sent', deploymentId: config.controlPlane.deploymentId })
}

export function startControlPlaneAgent(): void {
  if (!config.controlPlane.privateKey) {
    // validateConfig() already warned about this at boot — don't warn twice.
    return
  }

  scheduleWithLease(
    'control_plane_heartbeat',
    { intervalMs: INTERVAL_MS, leaseMs: 10 * 60 * 1000, firstRunDelayMs: 30_000 },
    sendHeartbeat
  )
  logger.info({ message: 'Control-plane agent started', intervalMinutes: INTERVAL_MS / 60_000 })
}
