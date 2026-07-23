import { pool } from '../connection'
import type {
  Assignment, GradeLetter, CriterionScore, RevisionCheckItem, CriteriaSnapshotItem,
  ConfidenceLevel, AiEnsemble, BulletItem, VerificationQuestion,
  Handout, QuestionResponse, ApprovedEditReason, ApprovedRevision, CalcStepVerdict, CitationVerdict,
} from '../../../../shared/types'

interface AssignmentRow {
  id: string
  teacher_id: string
  course_id: string | null
  student_name: string | null
  student_email: string | null
  student_group: string | null
  submission_text: string
  ai_score: number | null
  ai_grade: string | null
  ai_grade_label: string | null
  ai_feedback: string | null
  ai_criteria_scores: CriterionScore[] | null
  ai_strengths: BulletItem[] | null
  ai_improvements: BulletItem[] | null
  ai_verification_questions: VerificationQuestion[] | null
  ai_revision_check: RevisionCheckItem[] | null
  ai_question_responses: QuestionResponse[] | null
  ai_handout: Handout | null
  criteria_snapshot: CriteriaSnapshotItem[] | null
  ai_confidence: string | null
  ai_ensemble: AiEnsemble | null
  ai_calc_verification: CalcStepVerdict[] | null
  ai_citation_check: CitationVerdict[] | null
  ai_provider: string | null
  approved_score: number | null
  approved_grade: string | null
  approved_feedback: string | null
  approved_strengths: BulletItem[] | null
  approved_improvements: BulletItem[] | null
  approved_criteria_scores: CriterionScore[] | null
  approved_edit_reason: string | null
  brs_checkpoint_id: string | null
  approved_at: Date | null
  status: string
  parent_assignment_id: string | null
  revision_number: number
  created_at: Date
  lti_gradebook_synced_at: Date | null
  lti_gradebook_sync_error: string | null
}

function toAssignment(row: AssignmentRow): Assignment {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    course_id: row.course_id,
    student_name: row.student_name,
    student_email: row.student_email,
    student_group: row.student_group,
    submission_text: row.submission_text,
    ai_score: row.ai_score,
    ai_grade: row.ai_grade as GradeLetter | null,
    ai_grade_label: row.ai_grade_label,
    ai_feedback: row.ai_feedback,
    ai_criteria_scores: row.ai_criteria_scores,
    ai_strengths: row.ai_strengths,
    ai_improvements: row.ai_improvements,
    ai_verification_questions: row.ai_verification_questions,
    ai_revision_check: row.ai_revision_check,
    ai_question_responses: row.ai_question_responses,
    ai_handout: row.ai_handout,
    criteria_snapshot: row.criteria_snapshot,
    ai_confidence: row.ai_confidence as ConfidenceLevel | null,
    ai_ensemble: row.ai_ensemble,
    ai_calc_verification: row.ai_calc_verification,
    ai_citation_check: row.ai_citation_check,
    ai_provider: row.ai_provider,
    approved_score: row.approved_score,
    approved_grade: row.approved_grade as GradeLetter | null,
    approved_feedback: row.approved_feedback,
    approved_strengths: row.approved_strengths,
    approved_improvements: row.approved_improvements,
    approved_criteria_scores: row.approved_criteria_scores,
    approved_edit_reason: row.approved_edit_reason as ApprovedEditReason | null,
    brs_checkpoint_id: row.brs_checkpoint_id,
    approved_at: row.approved_at?.toISOString() ?? null,
    status: row.status as Assignment['status'],
    parent_assignment_id: row.parent_assignment_id,
    revision_number: row.revision_number,
    created_at: row.created_at.toISOString(),
    lti_gradebook_synced_at: row.lti_gradebook_synced_at?.toISOString() ?? null,
    lti_gradebook_sync_error: row.lti_gradebook_sync_error,
  }
}

export async function createAssignment(data: {
  teacherId: string
  courseId?: string
  studentName?: string
  studentEmail?: string
  studentGroup?: string
  submissionText: string
  aiScore: number
  aiGrade: GradeLetter
  aiGradeLabel: string
  aiFeedback: string
  aiCriteriaScores: CriterionScore[]
  aiStrengths: BulletItem[]
  aiImprovements: BulletItem[]
  aiVerificationQuestions?: VerificationQuestion[]
  criteriaSnapshot?: CriteriaSnapshotItem[] | null
  parentAssignmentId?: string
  aiRevisionCheck?: Array<{ point: string; status: string; note: string }>
  aiQuestionResponses?: QuestionResponse[]
  aiConfidence?: ConfidenceLevel | null
  aiEnsemble?: AiEnsemble | null
  aiCalcVerification?: CalcStepVerdict[]
  aiCitationCheck?: CitationVerdict[]
  aiProvider?: string
}): Promise<Assignment> {
  const { rows } = await pool.query<AssignmentRow>(
    `WITH parent AS (
       SELECT revision_number FROM assignments
       WHERE id = $15::uuid AND teacher_id = $1
     )
     INSERT INTO assignments (
       teacher_id, course_id, student_name, student_email, student_group,
       submission_text, ai_score, ai_grade, ai_grade_label, ai_feedback,
       ai_criteria_scores, ai_strengths, ai_improvements, criteria_snapshot,
       parent_assignment_id, ai_revision_check, ai_confidence, ai_ensemble,
       ai_verification_questions, ai_question_responses, ai_provider,
       ai_calc_verification, ai_citation_check,
       revision_number, status
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
       $15,$16,$17,$18,
       $19,$20,$21,
       $22,$23,
       COALESCE((SELECT revision_number + 1 FROM parent), 1),
       'pending'
     )
     RETURNING *`,
    [
      data.teacherId,
      data.courseId ?? null,
      data.studentName ?? null,
      data.studentEmail ?? null,
      data.studentGroup ?? null,
      data.submissionText,
      data.aiScore,
      data.aiGrade,
      data.aiGradeLabel,
      data.aiFeedback,
      JSON.stringify(data.aiCriteriaScores),
      JSON.stringify(data.aiStrengths),
      JSON.stringify(data.aiImprovements),
      data.criteriaSnapshot ? JSON.stringify(data.criteriaSnapshot) : null,
      data.parentAssignmentId ?? null,
      data.aiRevisionCheck ? JSON.stringify(data.aiRevisionCheck) : null,
      data.aiConfidence ?? null,
      data.aiEnsemble ? JSON.stringify(data.aiEnsemble) : null,
      data.aiVerificationQuestions ? JSON.stringify(data.aiVerificationQuestions) : null,
      data.aiQuestionResponses ? JSON.stringify(data.aiQuestionResponses) : null,
      data.aiProvider ?? null,
      data.aiCalcVerification && data.aiCalcVerification.length > 0 ? JSON.stringify(data.aiCalcVerification) : null,
      data.aiCitationCheck && data.aiCitationCheck.length > 0 ? JSON.stringify(data.aiCitationCheck) : null,
    ]
  )
  return toAssignment(rows[0])
}

export async function findAssignmentById(id: string, teacherId: string): Promise<Assignment | null> {
  const { rows } = await pool.query<AssignmentRow>(
    'SELECT * FROM assignments WHERE id = $1 AND teacher_id = $2 LIMIT 1',
    [id, teacherId]
  )
  return rows[0] ? toAssignment(rows[0]) : null
}

export async function approveAssignment(
  id: string,
  teacherId: string,
  data: {
    approvedScore: number
    approvedGrade: GradeLetter
    approvedFeedback: string
    approvedStrengths?: BulletItem[]      // null/undefined = keep AI's default
    approvedImprovements?: BulletItem[]
    approvedCriteriaScores?: CriterionScore[]
    approvedEditReason?: ApprovedEditReason
    approvedBrsCheckpointId?: string | null   // Feature AE — контрольная точка this approval counts toward
  }
): Promise<Assignment | null> {
  // Two writes in one transaction: update the canonical assignments row AND
  // append to approved_revisions so the audit trail of every approve survives.
  // The conn is the same Pool client — pg auto-commits unless we explicitly
  // BEGIN, so we use a transaction here to avoid a half-written history.
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query<AssignmentRow>(
      `UPDATE assignments
       SET approved_score           = $3,
           approved_grade           = $4,
           approved_feedback        = $5,
           approved_strengths       = $6,
           approved_improvements    = $7,
           approved_criteria_scores = $8,
           approved_edit_reason     = $9,
           brs_checkpoint_id        = $10,
           approved_at              = NOW(),
           status                   = 'approved'
       WHERE id = $1 AND teacher_id = $2
       RETURNING *`,
      [
        id, teacherId,
        data.approvedScore, data.approvedGrade, data.approvedFeedback,
        data.approvedStrengths        ? JSON.stringify(data.approvedStrengths)        : null,
        data.approvedImprovements     ? JSON.stringify(data.approvedImprovements)     : null,
        data.approvedCriteriaScores   ? JSON.stringify(data.approvedCriteriaScores)   : null,
        data.approvedEditReason       ?? null,
        data.approvedBrsCheckpointId  ?? null,
      ]
    )

    if (!rows[0]) {
      await client.query('ROLLBACK')
      return null
    }

    await client.query(
      `INSERT INTO approved_revisions (
         assignment_id, actor_teacher_id,
         approved_score, approved_grade, approved_feedback,
         approved_strengths, approved_improvements,
         approved_criteria_scores, approved_edit_reason, brs_checkpoint_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        id, teacherId,
        data.approvedScore, data.approvedGrade, data.approvedFeedback,
        data.approvedStrengths        ? JSON.stringify(data.approvedStrengths)        : null,
        data.approvedImprovements     ? JSON.stringify(data.approvedImprovements)     : null,
        data.approvedCriteriaScores   ? JSON.stringify(data.approvedCriteriaScores)   : null,
        data.approvedEditReason       ?? null,
        data.approvedBrsCheckpointId  ?? null,
      ]
    )

    await client.query('COMMIT')
    return toAssignment(rows[0])
  } catch (err) {
    await client.query('ROLLBACK').catch(() => null)
    throw err
  } finally {
    client.release()
  }
}

// ─── Approval history ────────────────────────────────────────────────────────

export async function findApprovalHistory(
  assignmentId: string,
  teacherId:    string,
): Promise<ApprovedRevision[]> {
  // Verify the teacher owns the row before returning the history (otherwise
  // another teacher could pull approval trails by guessing assignment ids).
  const { rows } = await pool.query<{
    approved_at:              Date
    actor_teacher_id:         string | null
    approved_score:           number | null
    approved_grade:           string | null
    approved_feedback:        string | null
    approved_strengths:       BulletItem[] | null
    approved_improvements:    BulletItem[] | null
    approved_criteria_scores: CriterionScore[] | null
    approved_edit_reason:     string | null
  }>(
    `SELECT r.approved_at, r.actor_teacher_id,
            r.approved_score, r.approved_grade, r.approved_feedback,
            r.approved_strengths, r.approved_improvements,
            r.approved_criteria_scores, r.approved_edit_reason
       FROM approved_revisions r
       JOIN assignments a ON a.id = r.assignment_id
      WHERE r.assignment_id = $1
        AND a.teacher_id = $2
      ORDER BY r.approved_at DESC`,
    [assignmentId, teacherId]
  )
  return rows.map((r) => ({
    approved_at:              r.approved_at.toISOString(),
    actor_teacher_id:         r.actor_teacher_id,
    approved_score:           r.approved_score,
    approved_grade:           r.approved_grade as GradeLetter | null,
    approved_feedback:        r.approved_feedback,
    approved_strengths:       r.approved_strengths,
    approved_improvements:    r.approved_improvements,
    approved_criteria_scores: r.approved_criteria_scores,
    approved_edit_reason:     r.approved_edit_reason as ApprovedEditReason | null,
  }))
}

export async function updateEmbedding(id: string, embedding: number[]): Promise<void> {
  await pool.query(
    `UPDATE assignments SET embedding = $2 WHERE id = $1`,
    [id, `[${embedding.join(',')}]`]
  )
}

/** Save / overwrite the last handout composed for an assignment. */
export async function saveHandout(
  id: string,
  teacherId: string,
  handout: Handout,
): Promise<void> {
  await pool.query(
    `UPDATE assignments SET ai_handout = $3::jsonb WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId, JSON.stringify(handout)]
  )
}

// SimilarAssignment carries the row id + similarity distance so the caller
// can audit which past works were retrieved as RAG examples (rag_retrievals
// table). The id never reaches the prompt; only the prose fields do.
//
// `source` distinguishes the two pools the retriever may union:
//   'own'         — same teacher, same course (original behaviour)
//   'institution' — different teacher in the same institution whose course
//                   shares the code/name AND has share_rag_with_institution = TRUE
//                   AND the institution's master shared_rag_enabled = TRUE.
// The caller uses `source` to sanitise PII on the institution pool only.
export interface SimilarAssignment {
  id:               string
  submission_text:  string
  approved_score:   number
  approved_grade:   string
  approved_feedback: string
  similarity:       number
  source:           'own' | 'institution'
  // Set when this example was fetched by findContrastingAssignment (not the
  // plain top-K similarity search) — lets the prompt label it distinctly so
  // the model treats it as a boundary marker, not another same-tier example.
  contrastive?:     boolean
}

export interface InstitutionPoolContext {
  institutionId: string
  teacherId:     string         // exclude this teacher from the institution pool
  courseCode:    string | null
  courseName:    string
}

/**
 * Decide whether a given (teacher, course) pair qualifies for the institutional
 * pool. Returns the context object findSimilarAssignments needs, or null when
 * any of the gating conditions is missing.
 *
 * Gates (all must be true):
 *   - teacher has an institution
 *   - institution.shared_rag_enabled = TRUE
 *   - the caller's own course has share_rag_with_institution = TRUE
 *
 * The caller's course flag is gated here (not in the SQL UNION) so a teacher
 * who hasn't opted in can't accidentally pull from the institution pool either.
 */
export async function resolveInstitutionPoolContext(
  teacherId: string,
  courseId: string,
): Promise<InstitutionPoolContext | null> {
  const { rows } = await pool.query<{
    institution_id:                string | null
    institution_shared:            boolean
    course_share_with_institution: boolean
    course_code:                   string | null
    course_name:                   string
  }>(
    `SELECT t.institution_id,
            COALESCE(i.shared_rag_enabled, FALSE) AS institution_shared,
            c.share_rag_with_institution           AS course_share_with_institution,
            c.code                                 AS course_code,
            c.name                                 AS course_name
       FROM teachers t
       JOIN courses  c ON c.id = $2 AND c.teacher_id = t.id
       LEFT JOIN institutions i ON i.id = t.institution_id
      WHERE t.id = $1
      LIMIT 1`,
    [teacherId, courseId]
  )

  const r = rows[0]
  if (!r) return null
  if (!r.institution_id) return null
  if (!r.institution_shared) return null
  if (!r.course_share_with_institution) return null

  return {
    institutionId: r.institution_id,
    teacherId,
    courseCode:    r.course_code,
    courseName:    r.course_name,
  }
}

/**
 * Find approved assignments similar to the input embedding. Always pulls from
 * the teacher's own course (`courseId`). When `institutionPool` is supplied
 * AND the institution master toggle is on, ALSO unions in approved grades
 * from other teachers' shared courses with matching code/name — the
 * institutional flywheel.
 *
 * Cross-teacher hits are tagged with source='institution' so the caller can
 * sanitise PII before they reach the prompt.
 */
export async function findSimilarAssignments(
  courseId: string,
  embedding: number[],
  limit = 5,
  institutionPool?: InstitutionPoolContext,
): Promise<SimilarAssignment[]> {
  const vec = `[${embedding.join(',')}]`

  // Plain path — no institution pool, no UNION, identical to the original.
  if (!institutionPool) {
    const { rows } = await pool.query<Omit<SimilarAssignment, 'source'>>(
      `SELECT id, submission_text, approved_score, approved_grade, approved_feedback,
              (embedding <=> $2) AS similarity
         FROM assignments
        WHERE course_id = $1
          AND status = 'approved'
          AND embedding IS NOT NULL
        ORDER BY embedding <=> $2
        LIMIT $3`,
      [courseId, vec, limit]
    )
    return rows.map((r) => ({ ...r, source: 'own' }))
  }

  // Reserve up to 2 of the `limit` slots for institution-pool hits so a
  // teacher's own corpus doesn't crowd out the cross-teacher signal entirely.
  // If the institution pool has fewer than that, we backfill from own.
  const institutionReserved = Math.min(2, Math.max(1, Math.floor(limit / 3)))
  const ownTarget = limit - institutionReserved

  // Run both queries in parallel.
  const ownPromise = pool.query<Omit<SimilarAssignment, 'source'>>(
    `SELECT id, submission_text, approved_score, approved_grade, approved_feedback,
            (embedding <=> $2) AS similarity
       FROM assignments
      WHERE course_id = $1
        AND status = 'approved'
        AND embedding IS NOT NULL
      ORDER BY embedding <=> $2
      LIMIT $3`,
    [courseId, vec, limit]   // overfetch — we may need to backfill
  )

  const institutionPromise = pool.query<Omit<SimilarAssignment, 'source'>>(
    `SELECT a.id, a.submission_text, a.approved_score, a.approved_grade, a.approved_feedback,
            (a.embedding <=> $2) AS similarity
       FROM assignments a
       JOIN courses  c2 ON c2.id = a.course_id
       JOIN teachers t2 ON t2.id = a.teacher_id
      WHERE t2.institution_id = $4::uuid
        AND t2.id <> $5::uuid
        AND c2.share_rag_with_institution = TRUE
        AND a.status = 'approved'
        AND a.embedding IS NOT NULL
        AND a.course_id <> $1
        AND (
          ($6::text IS NOT NULL AND c2.code IS NOT NULL AND LOWER(c2.code) = LOWER($6))
          OR LOWER(c2.name) = LOWER($7)
        )
      ORDER BY a.embedding <=> $2
      LIMIT $3`,
    [courseId, vec, institutionReserved + 2, institutionPool.institutionId,
     institutionPool.teacherId, institutionPool.courseCode, institutionPool.courseName]
  )

  const [ownRes, instRes] = await Promise.all([ownPromise, institutionPromise])

  const ownHits = ownRes.rows.map((r) => ({ ...r, source: 'own' as const }))
  const instHits = instRes.rows.map((r) => ({ ...r, source: 'institution' as const }))

  // Take reserved institution slots first, then fill the rest from own,
  // then merge and re-sort by similarity so the final order is honest.
  const reserved = instHits.slice(0, institutionReserved)
  const remaining = limit - reserved.length
  const ownTaken = ownHits.slice(0, Math.max(ownTarget, remaining))
  const combined = [...ownTaken, ...reserved]
    .sort((a, b) => a.similarity - b.similarity)
    .slice(0, limit)

  return combined
}

/**
 * Find the single nearest approved assignment whose grade is NOT in
 * `excludeGrades` — used to inject a grade-contrasting example when the
 * plain top-K similarity search comes back grade-homogeneous. Scoped to the
 * teacher's own course only (no institution-pool union — the contrast
 * signal matters most against the same grading history that produced the
 * homogeneous set).
 */
export async function findContrastingAssignment(
  courseId: string,
  embedding: number[],
  excludeIds: string[],
  excludeGrades: string[],
): Promise<SimilarAssignment | null> {
  const vec = `[${embedding.join(',')}]`
  const { rows } = await pool.query<Omit<SimilarAssignment, 'source' | 'contrastive'>>(
    `SELECT id, submission_text, approved_score, approved_grade, approved_feedback,
            (embedding <=> $2) AS similarity
       FROM assignments
      WHERE course_id = $1
        AND status = 'approved'
        AND embedding IS NOT NULL
        AND approved_grade <> ALL($3::text[])
        AND id <> ALL($4::uuid[])
      ORDER BY embedding <=> $2
      LIMIT 1`,
    [courseId, vec, excludeGrades, excludeIds]
  )
  return rows[0] ? { ...rows[0], source: 'own', contrastive: true } : null
}

/**
 * Time-respecting twin of findContrastingAssignment, for the eval harness —
 * only assignments approved before the target's creation are eligible.
 */
export async function findContrastingAssignmentBefore(
  courseId: string,
  embedding: number[],
  beforeCreatedAt: Date,
  excludeIds: string[],
  excludeGrades: string[],
): Promise<SimilarAssignment | null> {
  const vec = `[${embedding.join(',')}]`
  const { rows } = await pool.query<Omit<SimilarAssignment, 'source' | 'contrastive'>>(
    `SELECT id, submission_text, approved_score, approved_grade, approved_feedback,
            (embedding <=> $2) AS similarity
       FROM assignments
      WHERE course_id = $1
        AND status = 'approved'
        AND embedding IS NOT NULL
        AND created_at < $3
        AND approved_grade <> ALL($4::text[])
        AND id <> ALL($5::uuid[])
      ORDER BY embedding <=> $2
      LIMIT 1`,
    [courseId, vec, beforeCreatedAt, excludeGrades, excludeIds]
  )
  return rows[0] ? { ...rows[0], source: 'own', contrastive: true } : null
}

/**
 * Time-respecting variant for the eval harness: only assignments approved
 * BEFORE the target's creation are eligible as examples, and the target
 * itself is excluded. This simulates what the RAG flywheel would actually
 * have retrieved at the moment the target was originally graded.
 */
export async function findSimilarAssignmentsBefore(
  courseId: string,
  embedding: number[],
  beforeCreatedAt: Date,
  excludeId: string,
  limit = 5
): Promise<SimilarAssignment[]> {
  const { rows } = await pool.query<Omit<SimilarAssignment, 'source'>>(
    `SELECT id, submission_text, approved_score, approved_grade, approved_feedback,
            (embedding <=> $2) AS similarity
     FROM assignments
     WHERE course_id = $1
       AND status = 'approved'
       AND embedding IS NOT NULL
       AND created_at < $3
       AND id <> $4
     ORDER BY embedding <=> $2
     LIMIT $5`,
    [courseId, `[${embedding.join(',')}]`, beforeCreatedAt, excludeId, limit]
  )
  // Eval harness only replays a single teacher's history — no institution
  // pool involvement, so every hit is 'own' by definition.
  return rows.map((r) => ({ ...r, source: 'own' as const }))
}

// Replay target: an approved assignment with everything needed to re-grade it.
export interface ReplayTarget {
  id:                string
  course_id:         string
  submission_text:   string
  criteria_snapshot: CriteriaSnapshotItem[] | null
  approved_score:    number
  approved_grade:    string
  embedding_str:     string | null   // pgvector text form, parsed by caller
  created_at:        Date
}

/** All approved works of a teacher (optionally one course), oldest first. */
export async function findReplayTargets(
  teacherId: string,
  courseId?: string
): Promise<ReplayTarget[]> {
  const params: unknown[] = [teacherId]
  let where = `teacher_id = $1 AND status = 'approved'
               AND approved_score IS NOT NULL AND approved_grade IS NOT NULL
               AND course_id IS NOT NULL`
  if (courseId) { params.push(courseId); where += ` AND course_id = $${params.length}` }
  const { rows } = await pool.query<ReplayTarget>(
    `SELECT id, course_id, submission_text, criteria_snapshot,
            approved_score, approved_grade,
            embedding::text AS embedding_str, created_at
       FROM assignments
      WHERE ${where}
      ORDER BY created_at ASC`,
    params
  )
  return rows
}

export async function findAssignmentsByTeacher(
  teacherId: string,
  options: {
    courseId?: string; studentName?: string; studentGroup?: string
    search?: string; status?: string
    page?: number; limit?: number
  }
): Promise<{ assignments: Assignment[]; total: number }> {
  const page = Math.max(1, options.page ?? 1)
  const limit = Math.min(100, options.limit ?? 20)
  const offset = (page - 1) * limit

  // Build a parameterised WHERE from the supplied filters
  const conds: string[] = ['teacher_id = $1']
  const params: unknown[] = [teacherId]
  if (options.courseId)    { params.push(options.courseId);    conds.push(`course_id = $${params.length}`) }
  if (options.studentName) { params.push(options.studentName); conds.push(`student_name = $${params.length}`) }
  // student_group filter: NULL-safe (group may be empty)
  if (options.studentGroup !== undefined) {
    if (options.studentGroup === '') {
      conds.push('student_group IS NULL')
    } else {
      params.push(options.studentGroup); conds.push(`student_group = $${params.length}`)
    }
  }
  // Free-text search (История page) — partial, case-insensitive over name + group
  if (options.search) {
    params.push(`%${options.search}%`)
    const p = `$${params.length}`
    conds.push(`(student_name ILIKE ${p} OR student_group ILIKE ${p})`)
  }
  if (options.status) { params.push(options.status); conds.push(`status = $${params.length}`) }
  const whereClause = `WHERE ${conds.join(' AND ')}`

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query<AssignmentRow>(
      `SELECT * FROM assignments ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`,
      params
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM assignments ${whereClause}`,
      params
    ),
  ])

  return {
    assignments: rows.map(toAssignment),
    total: parseInt(countRows[0].count, 10),
  }
}

// Flat export for CSV / Moodle — all assignments for the teacher (optionally a course).
export interface AssignmentExportRow {
  student_name:    string | null
  student_email:   string | null
  student_group:   string | null
  approved_score:  number | null
  ai_score:        number | null
  approved_grade:  string | null
  ai_grade:        string | null
  approved_feedback: string | null
  ai_feedback:     string | null
  status:          string
  created_at:      Date
}

export async function findAssignmentsForExport(
  teacherId: string,
  courseId?: string
): Promise<AssignmentExportRow[]> {
  const params: unknown[] = [teacherId]
  let where = 'teacher_id = $1'
  if (courseId) { params.push(courseId); where += ` AND course_id = $${params.length}` }
  const { rows } = await pool.query<AssignmentExportRow>(
    `SELECT student_name, student_email, student_group,
            approved_score, ai_score, approved_grade, ai_grade,
            approved_feedback, ai_feedback, status, created_at
       FROM assignments WHERE ${where} ORDER BY created_at DESC`,
    params
  )
  return rows
}

// ─── Students aggregation (denormalized — grouped by name + group) ────────────

export interface StudentSummary {
  student_name:    string
  student_group:   string | null
  submissions:     number
  avg_score:       number | null   // average of approved (fallback ai) score
  last_submission: string          // ISO
}

export async function findStudentsByTeacher(
  teacherId: string,
  courseId?: string
): Promise<StudentSummary[]> {
  const params: unknown[] = [teacherId]
  let where = `teacher_id = $1 AND student_name IS NOT NULL AND student_name <> ''`
  if (courseId) { params.push(courseId); where += ` AND course_id = $${params.length}` }

  const { rows } = await pool.query<{
    student_name: string; student_group: string | null
    submissions: string; avg_score: string | null; last_submission: Date
  }>(
    `SELECT student_name,
            student_group,
            COUNT(*)                                              AS submissions,
            ROUND(AVG(COALESCE(approved_score, ai_score)))::text  AS avg_score,
            MAX(created_at)                                       AS last_submission
     FROM assignments
     WHERE ${where}
     GROUP BY student_name, student_group
     ORDER BY student_name ASC`,
    params
  )

  return rows.map((r) => ({
    student_name:    r.student_name,
    student_group:   r.student_group,
    submissions:     parseInt(r.submissions, 10),
    avg_score:       r.avg_score != null ? parseInt(r.avg_score, 10) : null,
    last_submission: r.last_submission.toISOString(),
  }))
}

// ─── Per-student trajectory (Feature B — grading-screen "За семестр" panel) ───

export interface TrajectoryEntry {
  id:               string
  created_at:       string
  score:            number | null
  grade:            string | null
  criteria_scores:  CriterionScore[] | null   // approved preferred, else the AI draft
}

/**
 * Last `limit` grades for a student the teacher already knows by name+group —
 * same identity key the Students page roster uses. Scoped to a course when
 * given (criteria are only comparable within one course); otherwise spans all
 * of the teacher's courses for that student. Excludes the assignment being
 * viewed right now so the panel never echoes the just-produced result back at
 * itself.
 */
export async function findStudentTrajectory(
  teacherId: string,
  studentName: string,
  studentGroup: string | null | undefined,
  options: { courseId?: string; excludeId?: string; limit?: number } = {}
): Promise<TrajectoryEntry[]> {
  const limit = Math.min(20, options.limit ?? 3)
  const params: unknown[] = [teacherId, studentName]
  let where = `teacher_id = $1 AND student_name = $2`
  // student_group is nullable — match NULL-to-NULL as "same student" too.
  params.push(studentGroup ?? null)
  where += ` AND student_group IS NOT DISTINCT FROM $${params.length}`
  if (options.courseId) { params.push(options.courseId); where += ` AND course_id = $${params.length}` }
  if (options.excludeId) { params.push(options.excludeId); where += ` AND id <> $${params.length}` }
  params.push(limit)

  const { rows } = await pool.query<{
    id: string; created_at: Date
    score: number | null; grade: string | null
    criteria_scores: CriterionScore[] | null
  }>(
    `SELECT id, created_at,
            COALESCE(approved_score, ai_score) AS score,
            COALESCE(approved_grade, ai_grade) AS grade,
            COALESCE(approved_criteria_scores, ai_criteria_scores) AS criteria_scores
       FROM assignments
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  )

  return rows.map((r) => ({
    id:              r.id,
    created_at:      r.created_at.toISOString(),
    score:           r.score,
    grade:           r.grade,
    criteria_scores: r.criteria_scores,
  }))
}

// ─── Cohort analytics (Feature C — Students page cohort tab) ──────────────────

export interface CohortRow {
  student_name:    string
  student_group:   string | null
  created_at:      string
  score:           number | null
  grade:           string | null
  criteria_scores: CriterionScore[] | null
}

// Cap keeps one aggregation request bounded even for a teacher with years of
// history piled onto one course — plenty for a semester's roster in practice.
const COHORT_ROW_LIMIT = 5000

/** Flat per-assignment rows for cohort aggregation — one row per graded work with a named student. */
export async function findCohortRows(teacherId: string, courseId?: string): Promise<CohortRow[]> {
  const params: unknown[] = [teacherId]
  let where = `teacher_id = $1 AND student_name IS NOT NULL AND student_name <> ''`
  if (courseId) { params.push(courseId); where += ` AND course_id = $${params.length}` }
  params.push(COHORT_ROW_LIMIT)

  const { rows } = await pool.query<{
    student_name: string; student_group: string | null; created_at: Date
    score: number | null; grade: string | null; criteria_scores: CriterionScore[] | null
  }>(
    `SELECT student_name, student_group, created_at,
            COALESCE(approved_score, ai_score) AS score,
            COALESCE(approved_grade, ai_grade) AS grade,
            COALESCE(approved_criteria_scores, ai_criteria_scores) AS criteria_scores
       FROM assignments
      WHERE ${where}
      ORDER BY created_at DESC
      LIMIT $${params.length}`,
    params
  )

  return rows.map((r) => ({
    student_name:    r.student_name,
    student_group:   r.student_group,
    created_at:      r.created_at.toISOString(),
    score:           r.score,
    grade:           r.grade,
    criteria_scores: r.criteria_scores,
  }))
}
