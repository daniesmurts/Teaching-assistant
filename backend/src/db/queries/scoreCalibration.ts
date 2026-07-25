import { pool } from '../connection'
import type { CalibrationPoint } from '../../lib/scoreCalibration'

export type CalibrationScopeType = 'course' | 'teacher' | 'institution'

export interface StoredCalibration {
  points:     CalibrationPoint[]
  sampleSize: number
  fittedAt:   string
}

export interface ScorePair {
  aiScore:      number
  teacherScore: number
  createdAt:    string   // ISO — used only by the chronological validation split
}

/** Fitted calibration map for one scope, or null when never fitted. */
export async function getCalibration(
  scopeType: CalibrationScopeType,
  scopeId:   string,
): Promise<StoredCalibration | null> {
  const { rows } = await pool.query<{ points: CalibrationPoint[]; sample_size: number; fitted_at: Date }>(
    `SELECT points, sample_size, fitted_at
       FROM score_calibration
      WHERE scope_type = $1 AND scope_id = $2`,
    [scopeType, scopeId]
  )
  const r = rows[0]
  if (!r) return null
  return { points: r.points, sampleSize: r.sample_size, fittedAt: r.fitted_at.toISOString() }
}

export async function upsertCalibration(
  scopeType:  CalibrationScopeType,
  scopeId:    string,
  points:     CalibrationPoint[],
  sampleSize: number,
): Promise<void> {
  await pool.query(
    `INSERT INTO score_calibration (scope_type, scope_id, points, sample_size, fitted_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (scope_type, scope_id) DO UPDATE SET
       points      = EXCLUDED.points,
       sample_size = EXCLUDED.sample_size,
       fitted_at   = NOW()`,
    [scopeType, scopeId, JSON.stringify(points), sampleSize]
  )
}

// Fitting input reads COALESCE(ai_score_raw, ai_score) — the model's OWN
// score, never one a previous calibration already corrected. `ai_score` holds
// the calibrated value that was shown to the teacher and persisted; fitting on
// that would learn "calibrated -> teacher" while inference keeps feeding a raw
// score, so train and inference distributions drift and the correction
// compounds with every refit. The COALESCE needs no backfill: rows written
// before migration 095 were graded with no map fitted, so their `ai_score`
// already IS the raw score.
//
// Deliberately NOT applied to the policy memo's delta query
// (db/queries/policyMemos.ts) — that one should keep measuring the RESIDUAL
// disagreement the teacher still had after calibration, so the prompt-level
// memo and the calibration map correct complementary things instead of both
// learning the same bias and double-correcting it.

/**
 * (raw ai_score, approved_score, created_at) history for one course — the
 * fitting input. `createdAt` is only consumed by validateCalibrationSplit's
 * chronological train/test split; the production fit path ignores it.
 */
export async function getScorePairsForCourse(courseId: string): Promise<ScorePair[]> {
  const { rows } = await pool.query<{ ai_score: number; approved_score: number; created_at: Date }>(
    `SELECT COALESCE(ai_score_raw, ai_score) AS ai_score, approved_score, created_at FROM assignments
      WHERE course_id = $1 AND status = 'approved'
        AND ai_score IS NOT NULL AND approved_score IS NOT NULL`,
    [courseId]
  )
  return rows.map((r) => ({ aiScore: r.ai_score, teacherScore: r.approved_score, createdAt: r.created_at.toISOString() }))
}

/** Same, scoped to every course/assignment owned by one teacher. */
export async function getScorePairsForTeacher(teacherId: string): Promise<ScorePair[]> {
  const { rows } = await pool.query<{ ai_score: number; approved_score: number; created_at: Date }>(
    `SELECT COALESCE(ai_score_raw, ai_score) AS ai_score, approved_score, created_at FROM assignments
      WHERE teacher_id = $1 AND status = 'approved'
        AND ai_score IS NOT NULL AND approved_score IS NOT NULL`,
    [teacherId]
  )
  return rows.map((r) => ({ aiScore: r.ai_score, teacherScore: r.approved_score, createdAt: r.created_at.toISOString() }))
}

/** Same, scoped to every teacher belonging to one institution. */
export async function getScorePairsForInstitution(institutionId: string): Promise<ScorePair[]> {
  const { rows } = await pool.query<{ ai_score: number; approved_score: number; created_at: Date }>(
    `SELECT COALESCE(a.ai_score_raw, a.ai_score) AS ai_score, a.approved_score, a.created_at FROM assignments a
       JOIN teachers t ON t.id = a.teacher_id
      WHERE t.institution_id = $1 AND a.status = 'approved'
        AND a.ai_score IS NOT NULL AND a.approved_score IS NOT NULL`,
    [institutionId]
  )
  return rows.map((r) => ({ aiScore: r.ai_score, teacherScore: r.approved_score, createdAt: r.created_at.toISOString() }))
}
