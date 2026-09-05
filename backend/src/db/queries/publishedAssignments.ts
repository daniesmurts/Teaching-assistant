import { randomBytes } from 'node:crypto'
import { pool } from '../connection'

// Process-of-creation attestation (Research.md §5.1, Feature Q). Teacher
// publishes a definition; students write against per-student tokenised invites.

export type PublishedStatus = 'draft' | 'open' | 'closed'
export type InviteStatus    = 'invited' | 'writing' | 'submitted'

export interface PublishedAssignmentRow {
  id:           string
  teacher_id:   string
  course_id:    string | null
  rubric_id:    string | null
  title:        string
  instructions: string | null
  due_at:       Date | null
  status:       string
  published_at: Date | null
  created_at:   Date
}

export interface PublishedAssignmentWithCounts extends PublishedAssignmentRow {
  invite_count:    number
  submitted_count: number
}

export interface AssignmentInviteRow {
  id:                      string
  published_assignment_id: string
  student_name:            string | null
  student_email:           string | null
  token:                   string
  status:                  string
  submitted_at:            Date | null
  created_at:              Date
}

/** URL-safe per-student token (the link credential). */
export function generateInviteToken(): string {
  return randomBytes(24).toString('hex')   // 48 hex chars
}

// ─── Definitions ──────────────────────────────────────────────────────────────

export async function createPublishedAssignment(data: {
  teacherId: string
  courseId?: string | null
  rubricId?: string | null
  title: string
  instructions?: string | null
  dueAt?: string | null
}): Promise<PublishedAssignmentRow> {
  const { rows } = await pool.query<PublishedAssignmentRow>(
    `INSERT INTO published_assignments (teacher_id, course_id, rubric_id, title, instructions, due_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.teacherId, data.courseId ?? null, data.rubricId ?? null,
     data.title, data.instructions ?? null, data.dueAt ?? null]
  )
  return rows[0]
}

/** Scoped to the owning teacher — returns null if not found or not theirs. */
export async function getPublishedAssignment(id: string, teacherId: string): Promise<PublishedAssignmentRow | null> {
  const { rows } = await pool.query<PublishedAssignmentRow>(
    'SELECT * FROM published_assignments WHERE id = $1 AND teacher_id = $2',
    [id, teacherId]
  )
  return rows[0] ?? null
}

/** Unscoped by teacher — used by the LTI student-launch path (routes/lti.ts)
 *  to resolve which lti_course_links row an AGS lineitem belongs to. A
 *  student's launch carries no teacher identity of its own, but the
 *  published_assignment_id it does carry already uniquely determines the
 *  course (unambiguous even when a Moodle context has multiple co-teacher
 *  links, unlike looking the link up by context_id alone). */
export async function getPublishedAssignmentCourseId(id: string): Promise<string | null> {
  const { rows } = await pool.query<{ course_id: string | null }>(
    'SELECT course_id FROM published_assignments WHERE id = $1',
    [id]
  )
  return rows[0]?.course_id ?? null
}

export async function listPublishedAssignments(teacherId: string): Promise<PublishedAssignmentWithCounts[]> {
  const { rows } = await pool.query<PublishedAssignmentWithCounts>(
    `SELECT pa.*,
            (SELECT COUNT(*)::int FROM assignment_invites i WHERE i.published_assignment_id = pa.id) AS invite_count,
            (SELECT COUNT(*)::int FROM assignment_invites i
               WHERE i.published_assignment_id = pa.id AND i.status = 'submitted') AS submitted_count
       FROM published_assignments pa
      WHERE pa.teacher_id = $1
      ORDER BY pa.created_at DESC`,
    [teacherId]
  )
  return rows
}

export async function updatePublishedAssignment(
  id: string,
  teacherId: string,
  patch: { title?: string; instructions?: string | null; dueAt?: string | null; status?: PublishedStatus }
): Promise<PublishedAssignmentRow | null> {
  // status → 'open' stamps published_at the first time.
  const { rows } = await pool.query<PublishedAssignmentRow>(
    `UPDATE published_assignments
        SET title        = COALESCE($3, title),
            instructions = CASE WHEN $4 THEN $5 ELSE instructions END,
            due_at       = CASE WHEN $6 THEN $7 ELSE due_at END,
            status       = COALESCE($8, status),
            published_at = CASE WHEN $8 = 'open' AND published_at IS NULL THEN NOW() ELSE published_at END
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [id, teacherId,
     patch.title ?? null,
     patch.instructions !== undefined, patch.instructions ?? null,
     patch.dueAt        !== undefined, patch.dueAt ?? null,
     patch.status ?? null]
  )
  return rows[0] ?? null
}

// ─── Invites (per-student) ────────────────────────────────────────────────────

export async function addInvite(
  publishedAssignmentId: string,
  data: { studentName?: string | null; studentEmail?: string | null }
): Promise<AssignmentInviteRow> {
  const { rows } = await pool.query<AssignmentInviteRow>(
    `INSERT INTO assignment_invites (published_assignment_id, student_name, student_email, token)
     VALUES ($1, $2, $3, $4)
     RETURNING id, published_assignment_id, student_name, student_email, token, status, submitted_at, created_at`,
    [publishedAssignmentId, data.studentName ?? null, data.studentEmail ?? null, generateInviteToken()]
  )
  return rows[0]
}

/**
 * Adds a whole group at once (TODO.md "### AO" follow-up). One statement, not
 * a loop of addInvite calls: a teacher pasting a group of 30 would otherwise
 * fire 30 round trips, and a failure halfway would leave the roster half
 * built with no signal about where it stopped.
 *
 * Each invite still gets its own token from generateInviteToken() — the
 * per-student link is what makes a submission attributable (§5.1), so there is
 * deliberately no shared "one link for the group" path anywhere in this file.
 */
export async function addInvitesBulk(
  publishedAssignmentId: string,
  names: string[],
): Promise<AssignmentInviteRow[]> {
  if (names.length === 0) return []

  const values: string[] = []
  const params: unknown[] = [publishedAssignmentId]
  names.forEach((name) => {
    params.push(name, generateInviteToken())
    values.push(`($1, $${params.length - 1}, $${params.length})`)
  })

  const { rows } = await pool.query<AssignmentInviteRow>(
    `INSERT INTO assignment_invites (published_assignment_id, student_name, token)
     VALUES ${values.join(', ')}
     RETURNING id, published_assignment_id, student_name, student_email, token, status, submitted_at, created_at`,
    params
  )
  return rows
}

/**
 * LTI student launch — find or create the invite for this (published
 * assignment, LMS student) pair. Idempotent so re-launching the same Moodle
 * activity (closed tab, re-opened) lands on the same in-progress draft
 * instead of minting a fresh token each time. The student still authenticates
 * purely via the resulting `token` — LTI only changes how the invite is
 * created and how the student arrives at the URL, never what secures it.
 */
export async function findOrCreateLtiInvite(params: {
  publishedAssignmentId: string
  ltiSubject:            string
  ltiDeploymentId:       string
  ltiContextId:          string
  studentName:           string | null
  studentEmail:          string | null
}): Promise<AssignmentInviteRow> {
  const { rows: existing } = await pool.query<AssignmentInviteRow>(
    `SELECT id, published_assignment_id, student_name, student_email, token, status, submitted_at, created_at
       FROM assignment_invites
      WHERE published_assignment_id = $1 AND lti_subject = $2
      LIMIT 1`,
    [params.publishedAssignmentId, params.ltiSubject]
  )
  if (existing[0]) return existing[0]

  const { rows } = await pool.query<AssignmentInviteRow>(
    `INSERT INTO assignment_invites
       (published_assignment_id, student_name, student_email, token,
        lti_subject, lti_deployment_id, lti_context_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, published_assignment_id, student_name, student_email, token, status, submitted_at, created_at`,
    [params.publishedAssignmentId, params.studentName, params.studentEmail, generateInviteToken(),
     params.ltiSubject, params.ltiDeploymentId, params.ltiContextId]
  )
  return rows[0]
}

export async function listInvites(publishedAssignmentId: string): Promise<AssignmentInviteRow[]> {
  const { rows } = await pool.query<AssignmentInviteRow>(
    `SELECT id, published_assignment_id, student_name, student_email, token, status, submitted_at, created_at
       FROM assignment_invites
      WHERE published_assignment_id = $1
      ORDER BY created_at`,
    [publishedAssignmentId]
  )
  return rows
}

/** Delete an invite — only allowed while the student has not yet submitted. */
export async function deleteInvite(inviteId: string, publishedAssignmentId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM assignment_invites
      WHERE id = $1 AND published_assignment_id = $2 AND status <> 'submitted'`,
    [inviteId, publishedAssignmentId]
  )
  return (rowCount ?? 0) > 0
}

// ─── Public student writing surface (token-authed, no teacher JWT) ────────────

export interface InviteWithAssignment {
  id:                   string
  status:               string
  student_name:         string | null
  draft_content:        unknown
  consent_accepted_at:  Date | null
  submitted_at:         Date | null
  // joined from the parent definition
  title:                string
  instructions:         string | null
  due_at:               Date | null
  assignment_status:    string         // 'draft' | 'open' | 'closed'
}

/** Resolve a token to its invite + parent definition. The only credential on
 *  the public route — returns null for an unknown token (caller 404s). */
export async function getInviteByToken(token: string): Promise<InviteWithAssignment | null> {
  const { rows } = await pool.query<InviteWithAssignment>(
    `SELECT i.id, i.status, i.student_name, i.draft_content, i.consent_accepted_at, i.submitted_at,
            pa.title, pa.instructions, pa.due_at, pa.status AS assignment_status
       FROM assignment_invites i
       JOIN published_assignments pa ON pa.id = i.published_assignment_id
      WHERE i.token = $1`,
    [token]
  )
  return rows[0] ?? null
}

export async function recordConsent(token: string, version: string): Promise<void> {
  await pool.query(
    `UPDATE assignment_invites
        SET consent_accepted_at = COALESCE(consent_accepted_at, NOW()),
            consent_version     = COALESCE(consent_version, $2),
            status              = CASE WHEN status = 'invited' THEN 'writing' ELSE status END
      WHERE token = $1`,
    [token, version]
  )
}

/** Autosave: overwrite the live draft + aggregate telemetry, mark 'writing'. */
export async function saveDraft(token: string, draftContent: unknown, telemetry: unknown): Promise<void> {
  await pool.query(
    `UPDATE assignment_invites
        SET draft_content        = $2,
            submission_telemetry = $3,
            status               = CASE WHEN status = 'submitted' THEN status
                                        ELSE 'writing' END
      WHERE token = $1`,
    [token, draftContent === undefined ? null : JSON.stringify(draftContent),
     telemetry === undefined ? null : JSON.stringify(telemetry)]
  )
}

/** Append a trajectory snapshot (§5.3). Sequence is per-invite, monotonic. */
export async function createSnapshot(inviteId: string, content: unknown, charCount: number): Promise<void> {
  await pool.query(
    `INSERT INTO submission_snapshots (invite_id, seq, content, char_count)
     VALUES ($1,
             COALESCE((SELECT MAX(seq) + 1 FROM submission_snapshots WHERE invite_id = $1), 1),
             $2, $3)`,
    [inviteId, content === undefined ? null : JSON.stringify(content), charCount]
  )
}

/** Finalise: mark the invite submitted. Does NOT create the gradeable
 *  `assignments` row — that materialisation happens in Q4 (grading integration),
 *  keeping ungraded rows out of history until the teacher grades. */
export async function markInviteSubmitted(token: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `UPDATE assignment_invites
        SET status = 'submitted', submitted_at = NOW()
      WHERE token = $1 AND status <> 'submitted'`,
    [token]
  )
  return (rowCount ?? 0) > 0
}

export async function getInviteIdByToken(token: string): Promise<string | null> {
  const { rows } = await pool.query<{ id: string }>(
    'SELECT id FROM assignment_invites WHERE token = $1',
    [token]
  )
  return rows[0]?.id ?? null
}

// ─── Teacher-side submission review (Q4) ──────────────────────────────────────

export interface SubmittedInvite {
  id:                   string
  student_name:         string | null
  student_email:        string | null
  draft_content:        unknown
  submission_telemetry: unknown
  submitted_at:         Date | null
  course_id:            string | null      // from the parent definition
  // linked graded assignment (null until the teacher grades — Q4b)
  assignment_id:        string | null
  ai_score:             number | null
  ai_grade:             string | null
  ai_grade_label:       string | null
  ai_feedback:          string | null
  ai_strengths:         string[] | null
  ai_improvements:      string[] | null
  grade_status:         string | null
}

/** A submitted invite's content + telemetry + any linked grade, scoped to the
 *  owning teacher. Returns null unless the invite belongs to a definition this
 *  teacher owns and has been submitted. */
export async function getSubmissionForTeacher(
  publishedAssignmentId: string,
  inviteId: string,
  teacherId: string,
): Promise<SubmittedInvite | null> {
  const { rows } = await pool.query<SubmittedInvite>(
    `SELECT i.id, i.student_name, i.student_email, i.draft_content, i.submission_telemetry,
            i.submitted_at, i.assignment_id, pa.course_id,
            a.ai_score, a.ai_grade, a.ai_grade_label, a.ai_feedback,
            a.ai_strengths, a.ai_improvements, a.status AS grade_status
       FROM assignment_invites i
       JOIN published_assignments pa ON pa.id = i.published_assignment_id
       LEFT JOIN assignments a ON a.id = i.assignment_id
      WHERE i.id = $1
        AND i.published_assignment_id = $2
        AND pa.teacher_id = $3
        AND i.status = 'submitted'`,
    [inviteId, publishedAssignmentId, teacherId]
  )
  return rows[0] ?? null
}

/** After grading materialises an `assignments` row, attach the published-
 *  assignment provenance to it and link the invite — atomically. */
export async function attachSubmissionToGrade(
  assignmentId: string,
  inviteId: string,
  publishedAssignmentId: string,
  telemetry: unknown,
  submittedAt: Date | null,
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query(
      `UPDATE assignments
          SET published_assignment_id = $2, submission_telemetry = $3, submitted_at = $4
        WHERE id = $1`,
      [assignmentId, publishedAssignmentId,
       telemetry == null ? null : JSON.stringify(telemetry), submittedAt]
    )
    await client.query(
      `UPDATE assignment_invites SET assignment_id = $2 WHERE id = $1`,
      [inviteId, assignmentId]
    )
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Cohort synthesis source rows ──────────────────────────────────────────────

export interface CohortSubmissionRow {
  approved_score:       number
  approved_grade:       string
  approved_improvements: unknown | null   // BulletItem[] — kept loosely typed here, parsed by the service
}

/** Approved submissions for one published assignment — the raw material for cohort synthesis. */
export async function findApprovedCohortSubmissions(
  publishedAssignmentId: string,
  teacherId: string,
): Promise<CohortSubmissionRow[]> {
  const { rows } = await pool.query<CohortSubmissionRow>(
    `SELECT a.approved_score, a.approved_grade, a.approved_improvements
       FROM assignments a
       JOIN published_assignments pa ON pa.id = a.published_assignment_id
      WHERE a.published_assignment_id = $1
        AND pa.teacher_id = $2
        AND a.status = 'approved'`,
    [publishedAssignmentId, teacherId]
  )
  return rows
}
