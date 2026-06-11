import { pool } from '../connection'
import type { LongReviewResult, LongReviewStatus, CriteriaSnapshotItem } from '../../../../shared/types'

export interface LongReviewRow {
  id:              string
  teacher_id:      string
  course_id:       string | null
  student_name:    string | null
  student_email:   string | null
  student_group:   string | null
  submission_text: string
  status:          LongReviewStatus
  progress_done:   number
  progress_total:  number
  assignment_id:   string | null
  result:          LongReviewResult | null
  error_message:   string | null
  criteria_snapshot: CriteriaSnapshotItem[] | null
  created_at:      string
}

export async function createLongReview(data: {
  teacherId:     string
  courseId?:     string
  studentName?:  string
  studentEmail?: string
  studentGroup?: string
  submissionText: string
}): Promise<LongReviewRow> {
  const { rows } = await pool.query<LongReviewRow>(
    `INSERT INTO long_reviews
       (teacher_id, course_id, student_name, student_email, student_group, submission_text)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING *`,
    [
      data.teacherId,
      data.courseId    ?? null,
      data.studentName ?? null,
      data.studentEmail ?? null,
      data.studentGroup ?? null,
      data.submissionText,
    ]
  )
  return rows[0]
}

export async function setLongReviewSnapshot(
  id: string,
  snapshot: CriteriaSnapshotItem[]
): Promise<void> {
  await pool.query(
    `UPDATE long_reviews SET criteria_snapshot = $2 WHERE id = $1`,
    [id, JSON.stringify(snapshot)]
  )
}

export async function getLongReviewById(id: string, teacherId: string): Promise<LongReviewRow | null> {
  const { rows } = await pool.query<LongReviewRow>(
    `SELECT * FROM long_reviews WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

// Revisit a finished review from its linked assignment (e.g. from the student profile).
export async function getLongReviewByAssignmentId(
  assignmentId: string,
  teacherId: string
): Promise<LongReviewRow | null> {
  const { rows } = await pool.query<LongReviewRow>(
    `SELECT * FROM long_reviews
     WHERE assignment_id = $1 AND teacher_id = $2 AND status = 'ready'
     ORDER BY created_at DESC LIMIT 1`,
    [assignmentId, teacherId]
  )
  return rows[0] ?? null
}

export async function setLongReviewStatus(id: string, status: LongReviewStatus): Promise<void> {
  await pool.query(`UPDATE long_reviews SET status = $2 WHERE id = $1`, [id, status])
}

export async function setLongReviewProgress(id: string, done: number, total: number): Promise<void> {
  await pool.query(
    `UPDATE long_reviews SET progress_done = $2, progress_total = $3 WHERE id = $1`,
    [id, done, total]
  )
}

export async function completeLongReview(
  id: string,
  result: LongReviewResult,
  assignmentId: string | null
): Promise<void> {
  await pool.query(
    `UPDATE long_reviews
       SET status = 'ready', result = $2, assignment_id = $3, progress_done = progress_total
     WHERE id = $1`,
    [id, JSON.stringify(result), assignmentId]
  )
}

export async function failLongReview(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE long_reviews SET status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}
