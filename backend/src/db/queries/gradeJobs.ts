import { pool } from '../connection'
import type { GradeJobStatus } from '../../../../shared/types'
import type { GradeResponse } from '../../services/grading'

export interface GradeJobRow {
  id:            string
  teacher_id:    string
  status:        GradeJobStatus
  assignment_id: string | null
  result:        GradeResponse | null
  error_message: string | null
  created_at:    string
}

export async function createGradeJob(teacherId: string): Promise<GradeJobRow> {
  const { rows } = await pool.query<GradeJobRow>(
    `INSERT INTO grade_jobs (teacher_id) VALUES ($1) RETURNING *`,
    [teacherId]
  )
  return rows[0]
}

export async function getGradeJobById(id: string, teacherId: string): Promise<GradeJobRow | null> {
  const { rows } = await pool.query<GradeJobRow>(
    `SELECT * FROM grade_jobs WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

// Worker-side lookup — the pg-boss payload is trusted (built by our own
// route), so no teacher scoping here. Route handlers must use getGradeJobById.
export async function getGradeJobByIdUnscoped(id: string): Promise<GradeJobRow | null> {
  const { rows } = await pool.query<GradeJobRow>(
    `SELECT * FROM grade_jobs WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function setGradeJobProcessing(id: string): Promise<void> {
  await pool.query(`UPDATE grade_jobs SET status = 'processing' WHERE id = $1`, [id])
}

export async function completeGradeJob(
  id: string,
  result: GradeResponse,
  assignmentId: string
): Promise<void> {
  await pool.query(
    `UPDATE grade_jobs SET status = 'ready', result = $2, assignment_id = $3 WHERE id = $1`,
    [id, JSON.stringify(result), assignmentId]
  )
}

export async function failGradeJob(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE grade_jobs SET status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}
