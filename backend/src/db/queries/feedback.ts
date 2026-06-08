import { pool } from '../connection'

export interface FeedbackRow {
  id:         string
  teacher_id: string | null
  category:   string
  message:    string
  page:       string | null
  created_at: string
}

export interface FeedbackWithTeacher extends FeedbackRow {
  teacher_email: string | null
  teacher_name:  string | null
}

export async function listFeedback(limit = 100): Promise<FeedbackWithTeacher[]> {
  const { rows } = await pool.query<FeedbackWithTeacher>(
    `SELECT f.*, t.email AS teacher_email, t.name AS teacher_name
       FROM feedback f
       LEFT JOIN teachers t ON t.id = f.teacher_id
       ORDER BY f.created_at DESC
       LIMIT $1`,
    [Math.min(limit, 500)]
  )
  return rows
}

export async function createFeedback(data: {
  teacherId: string
  category:  string
  message:   string
  page?:     string
}): Promise<FeedbackRow> {
  const { rows } = await pool.query<FeedbackRow>(
    `INSERT INTO feedback (teacher_id, category, message, page)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.teacherId, data.category, data.message, data.page ?? null]
  )
  return rows[0]
}
