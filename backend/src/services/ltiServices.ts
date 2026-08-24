/**
 * LTI Advantage service calls (AGS grade write-back today; NRPS roster sync
 * later). Separate from services/lti.ts, which owns launch/JWKS/token-
 * exchange plumbing — this file is the thin layer of actual service calls
 * built on top of it.
 */
import { logger } from '../lib/logger'
import { pool } from '../db/connection'
import { getLtiConfig, type LtiConfigRow } from '../db/queries/institutions'
import { findLtiGradeSyncTarget } from '../db/queries/ltiLineItems'
import { getServiceAccessToken } from './lti'
import { AppError } from '../errors/AppError'
import type {
  Assignment,
  LtiRosterMember,
} from '../../../shared/types'

const AGS_SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score'
const NRPS_SCOPE = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly'

/**
 * Posts an approved grade to the Moodle (or other LTI platform) gradebook.
 * Fire-and-forget from services/grading.ts `approve()` — same contract as
 * the existing embedding/policy-memo side effects: never blocks or fails
 * the approve response, records its own outcome for the UI to surface.
 *
 * A silent no-op for the overwhelming majority of assignments, which aren't
 * LTI-sourced at all (findLtiGradeSyncTarget returns null for anything not
 * launched by an LTI student — the normal case today).
 */
export async function syncGradeToLtiGradebook(assignment: Assignment): Promise<void> {
  if (assignment.approved_score === null) return

  const target = await findLtiGradeSyncTarget(assignment.id)
  if (!target) return

  try {
    const cfg = await getLtiConfig(target.institutionId)
    if (!cfg) throw new Error('institution has no LTI config')

    const accessToken = await getServiceAccessToken(cfg, [AGS_SCORE_SCOPE])

    // Per the AGS spec the scores endpoint is always the lineitem URL with
    // /scores appended, regardless of any query string the lineitem URL
    // itself carries (Moodle's lineitem URLs are query-string-free anyway).
    const scoreUrl = `${target.lineitemUrl}/scores`

    const response = await fetch(scoreUrl, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/vnd.ims.lis.v1.score+json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        userId:             target.ltiSubject,
        scoreGiven:         assignment.approved_score,
        scoreMaximum:       100,
        activityProgress:   'Completed',
        gradingProgress:    'FullyGraded',
        timestamp:          new Date().toISOString(),
      }),
    })

    if (!response.ok) {
      throw new Error(`platform rejected score POST (${response.status})`)
    }

    await pool.query(
      `UPDATE assignments SET lti_gradebook_synced_at = NOW(), lti_gradebook_sync_error = NULL WHERE id = $1`,
      [assignment.id]
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    logger.warn({ message: 'LTI AGS grade sync failed', assignmentId: assignment.id, error: message })
    await pool.query(
      `UPDATE assignments SET lti_gradebook_sync_error = $2 WHERE id = $1`,
      [assignment.id, message]
    )
  }
}

// ─── NRPS roster fetch ─────────────────────────────────────────────────────────

/**
 * Fetches the class roster from the platform's NRPS endpoint, filtered to
 * Learner-role members. Called on-demand from the published-assignment
 * invite UI (not automatic on every launch — NRPS is a pull, not a push).
 */
export async function fetchRoster(cfg: LtiConfigRow, membershipsUrl: string): Promise<LtiRosterMember[]> {
  const accessToken = await getServiceAccessToken(cfg, [NRPS_SCOPE])

  const response = await fetch(membershipsUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept':        'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
    },
  })
  if (!response.ok) {
    throw new AppError(`Платформа отклонила запрос списка студентов (${response.status})`, 502, 'LTI_NRPS_REJECTED')
  }

  const body = await response.json() as {
    members?: Array<{ status?: string; roles?: string[]; user_id?: string; name?: string; email?: string }>
  }

  return (body.members ?? [])
    .filter(m => m.status !== 'Deleted' && (m.roles ?? []).some(r => r.endsWith('#Learner')))
    .map(m => ({ userId: String(m.user_id), name: m.name ?? null, email: m.email ?? null }))
}
