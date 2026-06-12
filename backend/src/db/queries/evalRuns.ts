import { pool } from '../connection'
import type { CriterionScore } from '../../../../shared/types'

export interface EvalRun {
  id:           string
  teacher_id:   string | null
  course_id:    string | null
  model:        string
  conditions:   number[]
  status:       string
  notes:        string | null
  created_at:   Date
  completed_at: Date | null
}

export async function createEvalRun(data: {
  teacherId:  string
  courseId?:  string
  model:      string
  conditions: number[]
  notes?:     string
}): Promise<EvalRun> {
  const { rows } = await pool.query<EvalRun>(
    `INSERT INTO eval_runs (teacher_id, course_id, model, conditions, notes)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [data.teacherId, data.courseId ?? null, data.model, data.conditions, data.notes ?? null]
  )
  return rows[0]
}

export async function getEvalRun(id: string): Promise<EvalRun | null> {
  const { rows } = await pool.query<EvalRun>('SELECT * FROM eval_runs WHERE id = $1', [id])
  return rows[0] ?? null
}

export async function completeEvalRun(id: string, status: 'done' | 'failed'): Promise<void> {
  await pool.query(
    `UPDATE eval_runs SET status = $2, completed_at = NOW() WHERE id = $1`,
    [id, status]
  )
}

/** (assignment_id, k) pairs already replayed — used to resume a run. */
export async function findCompletedConditions(runId: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ assignment_id: string; k: number }>(
    `SELECT assignment_id, k FROM eval_results WHERE run_id = $1 AND error IS NULL`,
    [runId]
  )
  return new Set(rows.map((r) => `${r.assignment_id}:${r.k}`))
}

export async function insertEvalResult(data: {
  runId:          string
  assignmentId:   string
  k:              number
  examplesUsed:   number
  replayScore:    number | null
  replayGrade:    string | null
  replayCriteria: CriterionScore[] | null
  teacherScore:   number
  teacherGrade:   string
  durationMs:     number
  error?:         string
}): Promise<void> {
  await pool.query(
    `INSERT INTO eval_results
       (run_id, assignment_id, k, examples_used, replay_score, replay_grade,
        replay_criteria, teacher_score, teacher_grade, duration_ms, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (run_id, assignment_id, k) DO UPDATE SET
       examples_used   = EXCLUDED.examples_used,
       replay_score    = EXCLUDED.replay_score,
       replay_grade    = EXCLUDED.replay_grade,
       replay_criteria = EXCLUDED.replay_criteria,
       duration_ms     = EXCLUDED.duration_ms,
       error           = EXCLUDED.error`,
    [
      data.runId, data.assignmentId, data.k, data.examplesUsed,
      data.replayScore, data.replayGrade,
      data.replayCriteria ? JSON.stringify(data.replayCriteria) : null,
      data.teacherScore, data.teacherGrade, data.durationMs, data.error ?? null,
    ]
  )
}

export interface EvalResultRow {
  assignment_id: string
  k:             number
  examples_used: number
  replay_score:  number | null
  replay_grade:  string | null
  teacher_score: number
  teacher_grade: string
  error:         string | null
}

export async function findEvalResults(runId: string): Promise<EvalResultRow[]> {
  const { rows } = await pool.query<EvalResultRow>(
    `SELECT assignment_id, k, examples_used, replay_score, replay_grade,
            teacher_score, teacher_grade, error
       FROM eval_results WHERE run_id = $1 ORDER BY k, assignment_id`,
    [runId]
  )
  return rows
}
