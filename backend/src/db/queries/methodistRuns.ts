import { pool } from '../connection'
import type { CheckKey, CheckOutcome } from '../../services/methodist/checks'

export type MethodistRunStatus = 'queued' | 'processing' | 'ready' | 'failed'

export interface MethodistRunRow {
  id:                string
  teacher_id:        string
  program_id:        string
  discipline_id:     string
  requested_checks:  CheckKey[]
  status:            MethodistRunStatus
  checks:            CheckOutcome[] | null
  error_message:     string | null
  created_at:        string
  updated_at:        string
}

export async function createMethodistRun(data: {
  teacherId:    string
  programId:    string
  disciplineId: string
  checks:       CheckKey[]
}): Promise<MethodistRunRow> {
  const { rows } = await pool.query<MethodistRunRow>(
    `INSERT INTO methodist_runs (teacher_id, program_id, discipline_id, requested_checks)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.teacherId, data.programId, data.disciplineId, data.checks]
  )
  return rows[0]
}

export async function getMethodistRun(id: string, teacherId: string): Promise<MethodistRunRow | null> {
  const { rows } = await pool.query<MethodistRunRow>(
    `SELECT * FROM methodist_runs WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

/** Most recent runs for this teacher, newest first — powers a simple run
 *  history. Capped: this is a recency list, not an archive. */
export async function listRecentMethodistRuns(teacherId: string, limit = 20): Promise<MethodistRunRow[]> {
  const { rows } = await pool.query<MethodistRunRow>(
    `SELECT * FROM methodist_runs WHERE teacher_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [teacherId, limit]
  )
  return rows
}

export async function setMethodistRunStatus(id: string, status: MethodistRunStatus): Promise<void> {
  await pool.query(
    `UPDATE methodist_runs SET status = $2, updated_at = NOW() WHERE id = $1`,
    [id, status]
  )
}

export async function completeMethodistRun(id: string, checks: CheckOutcome[]): Promise<void> {
  await pool.query(
    `UPDATE methodist_runs SET status = 'ready', checks = $2, updated_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(checks)]
  )
}

export async function failMethodistRun(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE methodist_runs SET status = 'failed', error_message = $2, updated_at = NOW() WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}
