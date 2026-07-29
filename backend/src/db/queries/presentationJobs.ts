import { pool } from '../connection'
import type { PresentationJobStatus } from '../../../../shared/types'
import type { GenerateResult } from '../../services/presentations'

export interface PresentationJobRow {
  id:              string
  teacher_id:      string
  status:          PresentationJobStatus
  presentation_id: string | null
  result:          GenerateResult | null
  error_message:   string | null
  created_at:      string
}

export async function createPresentationJob(teacherId: string): Promise<PresentationJobRow> {
  const { rows } = await pool.query<PresentationJobRow>(
    `INSERT INTO presentation_jobs (teacher_id) VALUES ($1) RETURNING *`,
    [teacherId]
  )
  return rows[0]
}

export async function getPresentationJobById(id: string, teacherId: string): Promise<PresentationJobRow | null> {
  const { rows } = await pool.query<PresentationJobRow>(
    `SELECT * FROM presentation_jobs WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

// Worker-side lookup — the pg-boss payload is trusted (built by our own
// route), so no teacher scoping here. Route handlers must use getPresentationJobById.
export async function getPresentationJobByIdUnscoped(id: string): Promise<PresentationJobRow | null> {
  const { rows } = await pool.query<PresentationJobRow>(
    `SELECT * FROM presentation_jobs WHERE id = $1`,
    [id]
  )
  return rows[0] ?? null
}

export async function setPresentationJobProcessing(id: string): Promise<void> {
  await pool.query(`UPDATE presentation_jobs SET status = 'processing' WHERE id = $1`, [id])
}

export async function completePresentationJob(
  id: string,
  result: GenerateResult
): Promise<void> {
  await pool.query(
    `UPDATE presentation_jobs SET status = 'ready', result = $2, presentation_id = $3 WHERE id = $1`,
    [id, JSON.stringify(result), result.presentation_id]
  )
}

export async function failPresentationJob(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE presentation_jobs SET status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}
