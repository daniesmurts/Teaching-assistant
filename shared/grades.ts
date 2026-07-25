// Russian 5-point scale — the canonical score↔grade mapping, shared by
// frontend and backend.
//
// These brackets used to live only in frontend/src/lib/grades.ts, with a
// comment noting they were "mirrored from the grading prompt in
// backend/src/services/grading.ts" — i.e. the same numbers were duplicated in
// four prompt strings plus one TS file, and the backend never actually applied
// them. It only *told the model* the bands and trusted whatever letter came
// back, so any post-processing of the score (deterministic weighted
// aggregation, per-scope calibration) silently left the letter stale and the
// record internally contradictory (e.g. score 71 labelled «Отлично»). That
// matters doubly because the eval harness computes QWK — the headline
// agreement metric — on grade LETTERS, so score-only improvements never
// showed up in it.
//
// Living here means one definition, enforced on both sides.

import type { GradeLetter } from './types'

export const GRADES: GradeLetter[] = ['5', '4', '3', '2']

/** [min, max] inclusive — the same boundaries stated to the model in the prompt. */
export const GRADE_BRACKETS: Record<GradeLetter, [number, number]> = {
  '5': [87, 100],
  '4': [73,  86],
  '3': [60,  72],
  '2': [ 0,  59],
}

/** Bracket a numeric score (0–100) into a Russian grade letter. */
export function scoreToGrade(score: number): GradeLetter {
  const s = Math.max(0, Math.min(100, Math.round(score)))
  if (s >= 87) return '5'
  if (s >= 73) return '4'
  if (s >= 60) return '3'
  return '2'
}

/**
 * Snap a score into a grade's bracket with the *minimum* movement: if the score
 * already falls within the bracket, leave it; otherwise pull it to the nearest
 * boundary. Preserves teacher intent (a bump from 4→5 keeps a score of 85 → 87,
 * not 93).
 */
export function snapScoreToGrade(score: number, grade: GradeLetter): number {
  const [lo, hi] = GRADE_BRACKETS[grade]
  if (score < lo) return lo
  if (score > hi) return hi
  return score
}

export function gradeLabel(grade: string | null | undefined): string {
  switch (grade) {
    case '5': return 'Отлично'
    case '4': return 'Хорошо'
    case '3': return 'Удовлетворительно'
    case '2': return 'Неудовлетворительно'
    default:  return '—'
  }
}
