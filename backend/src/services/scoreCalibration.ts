// Per-scope score calibration — service layer (Research §10.1 / TODO Feature AF).
//
// Wraps the pure fit/apply math in lib/scoreCalibration.ts with the DB reads
// and a short-TTL cache, mirroring confidence.ts's getActiveThresholds
// pattern. Fitting is explicit (triggered from the admin eval surface, like
// fitThresholdsForRun) — grading itself only ever does a cached read, never a
// live fit, so a slow/failed fetch can't add latency or risk to a grade.

import {
  fitIsotonicCalibration, validateCalibrationSplit,
  type CalibrationPoint, type CalibrationValidationResult, type ValidationOptions,
} from '../lib/scoreCalibration'
import {
  getCalibration, upsertCalibration,
  getScorePairsForCourse, getScorePairsForTeacher, getScorePairsForInstitution,
  type CalibrationScopeType,
} from '../db/queries/scoreCalibration'

export type { CalibrationScopeType } from '../db/queries/scoreCalibration'
export { applyCalibration } from '../lib/scoreCalibration'

// ── Cached per-scope maps ───────────────────────────────────────────────────
const cache = new Map<string, { value: CalibrationPoint[] | null; at: number }>()
const TTL_MS = 5 * 60 * 1000

function cacheKey(scopeType: CalibrationScopeType, scopeId: string): string {
  return `${scopeType}:${scopeId}`
}

async function getCachedMap(scopeType: CalibrationScopeType, scopeId: string): Promise<CalibrationPoint[] | null> {
  const key = cacheKey(scopeType, scopeId)
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value
  const stored = await getCalibration(scopeType, scopeId)
  const value = stored?.points ?? null
  cache.set(key, { value, at: Date.now() })
  return value
}

export function invalidateCalibrationCache(scopeType?: CalibrationScopeType, scopeId?: string): void {
  if (scopeType && scopeId) cache.delete(cacheKey(scopeType, scopeId))
  else cache.clear()
}

/**
 * Most-specific-first backoff: course -> teacher -> institution -> none. Each
 * hop only fires when the more specific scope was never fitted (or had too
 * little data) — never because it's the "default", so a cold-start course
 * still benefits from the teacher's own accumulated bias correction.
 */
export async function getActiveCalibrationMap(
  courseId:      string | null | undefined,
  teacherId:     string,
  institutionId: string | null | undefined,
): Promise<CalibrationPoint[] | null> {
  if (courseId) {
    const m = await getCachedMap('course', courseId)
    if (m) return m
  }
  const t = await getCachedMap('teacher', teacherId)
  if (t) return t
  if (institutionId) {
    const i = await getCachedMap('institution', institutionId)
    if (i) return i
  }
  return null
}

// ── Fitting ──────────────────────────────────────────────────────────────────

export interface FitResult {
  points:     CalibrationPoint[]
  sampleSize: number
}

/**
 * Pull (ai_score, approved_score) history for one scope, fit, and persist.
 * Returns null when there isn't enough approved history yet — callers should
 * surface that as "not enough data," not as a silent no-op.
 */
export async function fitCalibration(
  scopeType:   CalibrationScopeType,
  scopeId:     string,
  minSamples?: number,
): Promise<FitResult | null> {
  const pairs = await (
    scopeType === 'course'  ? getScorePairsForCourse(scopeId) :
    scopeType === 'teacher' ? getScorePairsForTeacher(scopeId) :
                               getScorePairsForInstitution(scopeId)
  )
  const points = fitIsotonicCalibration(pairs, minSamples)
  if (!points) return null

  await upsertCalibration(scopeType, scopeId, points, pairs.length)
  invalidateCalibrationCache(scopeType, scopeId)
  return { points, sampleSize: pairs.length }
}

// ── Validation (Research §10.0's "prove it before it ships" gate) ──────────
//
// Read-only: fits on the chronologically-earlier slice of the SAME approved
// history fitCalibration() would use, scores MAE/Spearman on the later slice
// the fit never saw, and reports both the corrected and uncorrected numbers
// side by side. Never touches `score_calibration` — safe to call repeatedly
// while deciding whether a scope is ready for fitCalibration() to go live.

export async function validateCalibration(
  scopeType: CalibrationScopeType,
  scopeId:   string,
  opts?:     ValidationOptions,
): Promise<CalibrationValidationResult | null> {
  const pairs = await (
    scopeType === 'course'  ? getScorePairsForCourse(scopeId) :
    scopeType === 'teacher' ? getScorePairsForTeacher(scopeId) :
                               getScorePairsForInstitution(scopeId)
  )
  const timestamped = pairs.map((p) => ({ ...p, createdAt: new Date(p.createdAt).getTime() }))
  return validateCalibrationSplit(timestamped, opts)
}
