// Gathers a TelemetryEnvelope from this deployment's own data —
// docs/on-prem-deployment.md §5.2, §16 Track 1.6. Every source here already
// existed for another purpose (usage rollups, incident logging, the version
// file); this just re-reads them into the envelope shape. Not pure — every
// block does a DB or filesystem read — but each read is a thing this
// deployment already computes for itself regardless of telemetry.

import { pool } from '../../db/connection'
import { getBuildVersion } from '../../lib/version'
import { getJobQueue } from '../jobQueue'
import { LONG_REVIEW_QUEUE } from '../longReviewWorker'
import { GRADE_JOB_QUEUE } from '../gradeJobWorker'
import { PRESENTATION_JOB_QUEUE } from '../presentationJobWorker'
import { FOS_QUEUE } from '../fosWorker'
import { getUsageByModel } from '../../db/queries/usageLog'
import { getInstitutionRollupForMonth } from '../../db/queries/usageRollup'
import { getIncidentCountsSince } from '../../db/queries/controlPlane'
import type { TelemetryEnvelope } from './envelope'

const ALL_QUEUES = [LONG_REVIEW_QUEUE, GRADE_JOB_QUEUE, PRESENTATION_JOB_QUEUE, FOS_QUEUE]

function currentMonthString(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

async function getSchemaVersion(): Promise<string> {
  const { rows } = await pool.query<{ filename: string }>(
    `SELECT filename FROM migrations ORDER BY filename DESC LIMIT 1`
  )
  return rows[0]?.filename ?? 'unknown'
}

async function checkDbOk(): Promise<boolean> {
  try {
    await pool.query('SELECT 1')
    return true
  } catch {
    return false
  }
}

/**
 * getJobQueue() throws synchronously if startJobQueue() hasn't run yet
 * (index.ts always calls it before startControlPlaneAgent(), so this is a
 * defensive guard, not the expected path in production) — one degraded
 * signal in a health block must never crash the whole heartbeat, so this
 * degrades to 0 instead of propagating.
 */
async function getQueueDepth(): Promise<number> {
  let boss
  try {
    boss = getJobQueue()
  } catch {
    return 0
  }
  const sizes = await Promise.all(ALL_QUEUES.map((q) => boss.getQueueSize(q).catch(() => 0)))
  return sizes.reduce((sum, n) => sum + n, 0)
}

async function getActiveSeatCount(): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM teachers WHERE is_active = TRUE`
  )
  return rows[0]?.count ?? 0
}

export interface BuildEnvelopeOptions {
  /** How far back the incidents block looks — should match the caller's own tick interval so consecutive envelopes tile without gaps or double-counting. */
  incidentsWindowMs: number
}

export async function buildEnvelope(opts: BuildEnvelopeOptions): Promise<TelemetryEnvelope> {
  const now = new Date()
  const windowStart = new Date(now.getTime() - opts.incidentsWindowMs)
  const appVersion = getBuildVersion()

  const [schemaVersion, dbOk, queueDepth, usageByModel, institutionRollup, activeSeats, incidents] =
    await Promise.all([
      getSchemaVersion(),
      checkDbOk(),
      getQueueDepth(),
      getUsageByModel(1),
      getInstitutionRollupForMonth(currentMonthString()),
      getActiveSeatCount(),
      getIncidentCountsSince(windowStart, now),
    ])

  return {
    platform: {
      appVersion,
      schemaVersion,
      uptimeSeconds: Math.round(process.uptime()),
    },
    health: {
      dbOk,
      queueDepth,
    },
    models: usageByModel.map((m) => ({
      provider:  m.provider,
      modelId:   m.model,
      calls24h:  m.call_count,
      errorRate: m.call_count > 0 ? m.error_count / m.call_count : 0,
    })),
    usage: institutionRollup.map((r) => ({
      month:               r.month,
      institutionId:       r.institution_id,
      activeSeats:         r.active_seats,
      seatsPurchased:      r.seats_purchased,
      overheadCallCount:   r.overhead_call_count,
      overheadTokens:      r.overhead_tokens,
      overheadCostUsd:     r.overhead_cost_usd,
      amortizedRevenueRub: r.amortized_revenue_rub,
      amortizedRevenueUsd: r.amortized_revenue_usd,
    })),
    seats: {
      active:   activeSeats,
      licensed: null,   // Track 2.7 — no licence file yet
    },
    incidents,
  }
}
