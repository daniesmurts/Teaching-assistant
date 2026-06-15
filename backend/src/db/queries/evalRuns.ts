import { pool } from '../connection'
import type { CriterionScore } from '../../../../shared/types'

export interface EvalRun {
  id:           string
  teacher_id:   string | null
  course_id:    string | null
  model:        string
  conditions:   number[]
  status:       string
  kind:         'flywheel' | 'confidence'
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
  kind?:      'flywheel' | 'confidence'
}): Promise<EvalRun> {
  const { rows } = await pool.query<EvalRun>(
    `INSERT INTO eval_runs (teacher_id, course_id, model, conditions, notes, kind)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [data.teacherId, data.courseId ?? null, data.model, data.conditions, data.notes ?? null, data.kind ?? 'flywheel']
  )
  return rows[0]
}

export async function getEvalRun(id: string): Promise<EvalRun | null> {
  const { rows } = await pool.query<EvalRun>('SELECT * FROM eval_runs WHERE id = $1', [id])
  return rows[0] ?? null
}

export interface EvalRunListItem extends EvalRun {
  result_count: number
  teacher_email: string | null
  course_name: string | null
}

/** All eval runs, newest first, with result counts + teacher/course labels for the admin list. */
export async function listEvalRuns(limit = 50): Promise<EvalRunListItem[]> {
  const { rows } = await pool.query<EvalRunListItem>(
    `SELECT r.*,
            t.email AS teacher_email,
            c.name  AS course_name,
            COALESCE(
              (SELECT COUNT(*) FROM eval_results er WHERE er.run_id = r.id),
              0
            ) + COALESCE(
              (SELECT COUNT(*) FROM confidence_results cr WHERE cr.run_id = r.id),
              0
            ) AS result_count
       FROM eval_runs r
       LEFT JOIN teachers t ON t.id = r.teacher_id
       LEFT JOIN courses  c ON c.id = r.course_id
      ORDER BY r.created_at DESC
      LIMIT $1`,
    [limit]
  )
  return rows.map((r) => ({ ...r, result_count: Number(r.result_count) }))
}

export async function completeEvalRun(
  id: string,
  status: 'done' | 'failed',
  reason?: string,
): Promise<void> {
  // When the harness exits with no work done (e.g. no replay targets), we
  // surface the reason in `notes` so the admin UI says *why* instead of just
  // a vague "ошибка". Never overwrites a user-supplied note — appends.
  if (reason) {
    await pool.query(
      `UPDATE eval_runs
          SET status = $2, completed_at = NOW(),
              notes = COALESCE(notes || E'\n', '') || $3
        WHERE id = $1`,
      [id, status, reason]
    )
    return
  }
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

// ─── Confidence-eval results ───────────────────────────────────────────────────

export async function insertConfidenceResult(data: {
  runId:          string
  assignmentId:   string
  consensusScore: number | null
  consensusGrade: string | null
  scoreStd:       number | null
  gradeAgreement: number | null
  confidence:     string | null
  teacherScore:   number
  teacherGrade:   string
  samples:        unknown | null
  durationMs:     number
  error?:         string
}): Promise<void> {
  await pool.query(
    `INSERT INTO confidence_results
       (run_id, assignment_id, consensus_score, consensus_grade, score_std,
        grade_agreement, confidence, teacher_score, teacher_grade, samples,
        duration_ms, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (run_id, assignment_id) DO UPDATE SET
       consensus_score = EXCLUDED.consensus_score,
       consensus_grade = EXCLUDED.consensus_grade,
       score_std       = EXCLUDED.score_std,
       grade_agreement = EXCLUDED.grade_agreement,
       confidence      = EXCLUDED.confidence,
       samples         = EXCLUDED.samples,
       duration_ms     = EXCLUDED.duration_ms,
       error           = EXCLUDED.error`,
    [
      data.runId, data.assignmentId, data.consensusScore, data.consensusGrade,
      data.scoreStd, data.gradeAgreement, data.confidence,
      data.teacherScore, data.teacherGrade,
      data.samples ? JSON.stringify(data.samples) : null,
      data.durationMs, data.error ?? null,
    ]
  )
}

export interface ConfidenceResultRow {
  assignment_id:   string
  consensus_score: number | null
  consensus_grade: string | null
  score_std:       string | null   // NUMERIC comes back as string
  grade_agreement: string | null
  confidence:      string | null
  teacher_score:   number
  teacher_grade:   string
  error:           string | null
}

export async function findConfidenceResults(runId: string): Promise<ConfidenceResultRow[]> {
  const { rows } = await pool.query<ConfidenceResultRow>(
    `SELECT assignment_id, consensus_score, consensus_grade, score_std,
            grade_agreement, confidence, teacher_score, teacher_grade, error
       FROM confidence_results WHERE run_id = $1`,
    [runId]
  )
  return rows
}

export async function findCompletedConfidenceIds(runId: string): Promise<Set<string>> {
  const { rows } = await pool.query<{ assignment_id: string }>(
    `SELECT assignment_id FROM confidence_results WHERE run_id = $1 AND error IS NULL`,
    [runId]
  )
  return new Set(rows.map((r) => r.assignment_id))
}
