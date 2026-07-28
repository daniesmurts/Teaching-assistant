import { pool } from '../connection'
import type { RpdSubmission, RpdSubmissionEvent, RpdSubmissionStatus, RpdSubmissionStage } from '../../../../shared/types'

interface SubmissionRow {
  id: string
  program_id: string
  discipline_id: string
  document_id: string | null
  status: string
  returned_by_stage: string | null
  submitted_by: string | null
  submitted_at: Date | null
  updated_at: Date
}

function toSubmission(r: SubmissionRow): RpdSubmission {
  return {
    id:                r.id,
    program_id:        r.program_id,
    discipline_id:     r.discipline_id,
    document_id:       r.document_id,
    status:            r.status as RpdSubmissionStatus,
    returned_by_stage: r.returned_by_stage as RpdSubmissionStage | null,
    submitted_by:      r.submitted_by,
    submitted_at:      r.submitted_at ? r.submitted_at.toISOString() : null,
    updated_at:        r.updated_at.toISOString(),
  }
}

/** Fetch-or-create — every discipline implicitly starts in 'draft' the first
 *  time anyone asks about it, so callers never have to special-case "no row
 *  yet" as a distinct condition from "row exists, status draft". */
export async function getOrCreateSubmission(
  programId: string, disciplineId: string,
): Promise<RpdSubmission> {
  const { rows } = await pool.query<SubmissionRow>(
    `INSERT INTO rpd_submissions (program_id, discipline_id, status)
     VALUES ($1, $2, 'draft')
     ON CONFLICT (discipline_id) DO UPDATE SET discipline_id = EXCLUDED.discipline_id
     RETURNING *`,
    [programId, disciplineId]
  )
  return toSubmission(rows[0])
}

export async function findSubmissionByDiscipline(disciplineId: string): Promise<RpdSubmission | null> {
  const { rows } = await pool.query<SubmissionRow>(
    `SELECT * FROM rpd_submissions WHERE discipline_id = $1`,
    [disciplineId]
  )
  return rows[0] ? toSubmission(rows[0]) : null
}

export async function findSubmissionById(id: string): Promise<RpdSubmission | null> {
  const { rows } = await pool.query<SubmissionRow>(`SELECT * FROM rpd_submissions WHERE id = $1`, [id])
  return rows[0] ? toSubmission(rows[0]) : null
}

/** Same lookup, scoped to one institution via its programme — the УМЦ queue
 *  endpoint uses this instead of the bare id lookup above so a submission id
 *  from another institution can't be acted on just by guessing/enumerating
 *  uuids (`umu:edit` is per-institution, not global). */
export async function findSubmissionByIdForInstitution(
  id: string, institutionId: string,
): Promise<RpdSubmission | null> {
  const { rows } = await pool.query<SubmissionRow>(
    `SELECT s.* FROM rpd_submissions s
       JOIN programs p ON p.id = s.program_id
      WHERE s.id = $1 AND p.institution_id = $2`,
    [id, institutionId]
  )
  return rows[0] ? toSubmission(rows[0]) : null
}

/**
 * Apply a transition transactionally: update the mutable row AND append the
 * append-only event in one commit, so the two can never disagree about what
 * happened (rule #5 posture — same reasoning as approved_revisions).
 */
export async function recordTransition(params: {
  submissionId: string
  toStatus:     RpdSubmissionStatus
  returnedByStage: RpdSubmissionStage | null
  documentId?:  string | null   // set on submit/resubmit; omitted (unchanged) otherwise
  actorId:      string | null
  comment?:     string | null
}): Promise<RpdSubmission> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows: current } = await client.query<SubmissionRow>(
      `SELECT * FROM rpd_submissions WHERE id = $1 FOR UPDATE`,
      [params.submissionId]
    )
    if (!current[0]) throw new Error('Submission not found')
    const fromStatus = current[0].status

    const { rows: updated } = await client.query<SubmissionRow>(
      `UPDATE rpd_submissions
          SET status = $2,
              returned_by_stage = $3,
              document_id = COALESCE($4, document_id),
              submitted_by = CASE WHEN $2 = 'submitted' THEN $5 ELSE submitted_by END,
              submitted_at = CASE WHEN $2 = 'submitted' THEN NOW() ELSE submitted_at END,
              updated_at = NOW()
        WHERE id = $1
      RETURNING *`,
      [params.submissionId, params.toStatus, params.returnedByStage, params.documentId ?? null, params.actorId]
    )

    await client.query(
      `INSERT INTO rpd_submission_events (submission_id, from_status, to_status, actor_id, comment)
       VALUES ($1, $2, $3, $4, $5)`,
      [params.submissionId, fromStatus, params.toStatus, params.actorId, params.comment ?? null]
    )

    await client.query('COMMIT')
    return toSubmission(updated[0])
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

interface EventRow {
  id: string
  from_status: string | null
  to_status: string
  actor_id: string | null
  actor_name: string | null
  comment: string | null
  created_at: Date
}

export async function listSubmissionEvents(submissionId: string): Promise<RpdSubmissionEvent[]> {
  const { rows } = await pool.query<EventRow>(
    `SELECT e.id, e.from_status, e.to_status, e.actor_id, t.name AS actor_name, e.comment, e.created_at
       FROM rpd_submission_events e
       LEFT JOIN teachers t ON t.id = e.actor_id
      WHERE e.submission_id = $1
      ORDER BY e.created_at`,
    [submissionId]
  )
  return rows.map((r) => ({
    id:          r.id,
    from_status: r.from_status as RpdSubmissionStatus | null,
    to_status:   r.to_status as RpdSubmissionStatus,
    actor_id:    r.actor_id,
    actor_name:  r.actor_name,
    comment:     r.comment,
    created_at:  r.created_at.toISOString(),
  }))
}

interface QueueRow extends SubmissionRow {
  discipline_name: string
  program_name: string
  program_code: string | null
  responsible_teacher_name: string | null
  coverage: string | null
}

function toQueueItem(r: QueueRow): RpdSubmission {
  return {
    ...toSubmission(r),
    discipline_name: r.discipline_name,
    program_name:    r.program_name,
    program_code:    r.program_code,
    responsible_teacher_name: r.responsible_teacher_name,
    coverage:        r.coverage != null ? Number(r.coverage) : null,
  }
}

const QUEUE_SELECT = `
  SELECT s.*, d.name AS discipline_name, p.name AS program_name, p.code AS program_code,
         t.name AS responsible_teacher_name,
         rev.result->>'overall_coverage' AS coverage
    FROM rpd_submissions s
    JOIN program_disciplines d ON d.id = s.discipline_id
    JOIN programs p ON p.id = s.program_id
    LEFT JOIN teachers t ON t.id = d.responsible_teacher_id
    LEFT JOIN LATERAL (
      SELECT result FROM program_document_reviews
       WHERE discipline_id = s.discipline_id
       ORDER BY created_at DESC
       LIMIT 1
    ) rev ON true
`

/** РОП's review queue — 'submitted' items across the programmes they hold. */
export async function listSubmittedForPrograms(programIds: string[]): Promise<RpdSubmission[]> {
  if (programIds.length === 0) return []
  const { rows } = await pool.query<QueueRow>(
    `${QUEUE_SELECT}
      WHERE s.status = 'submitted' AND s.program_id = ANY($1::uuid[])
      ORDER BY s.submitted_at`,
    [programIds]
  )
  return rows.map(toQueueItem)
}

/**
 * The document backing a discipline's *approved* РПД, if any. Topology graph
 * substrate (docs/topology-spec.md, Increment 0) prefers this over the
 * merely-latest upload (findWorkingProgrammeForDiscipline in
 * db/queries/programDocuments.ts) — the graph should never claim more
 * confidence than the document backing it has. discipline_id is UNIQUE on
 * rpd_submissions (migration 098), so no program_id scoping is needed.
 */
export async function findApprovedDocumentForDiscipline(
  disciplineId: string
): Promise<{ documentId: string; extractedText: string | null } | null> {
  const { rows } = await pool.query<{ document_id: string; extracted_text: string | null }>(
    `SELECT pd.id AS document_id, pd.extracted_text
       FROM rpd_submissions s
       JOIN program_documents pd ON pd.id = s.document_id
      WHERE s.discipline_id = $1 AND s.status = 'approved'`,
    [disciplineId]
  )
  return rows[0] ? { documentId: rows[0].document_id, extractedText: rows[0].extracted_text } : null
}

/** УМЦ's queue — 'forwarded' items institution-wide (programs join scopes by
 *  institution_id, not by held unit — УМУ/УМЦ access is horizontal). */
export async function listForwardedForInstitution(institutionId: string): Promise<RpdSubmission[]> {
  const { rows } = await pool.query<QueueRow>(
    `${QUEUE_SELECT}
      WHERE s.status = 'forwarded' AND p.institution_id = $1
      ORDER BY s.updated_at`,
    [institutionId]
  )
  return rows.map(toQueueItem)
}
