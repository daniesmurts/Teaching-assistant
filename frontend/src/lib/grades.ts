import type { GradeLetter } from '../types'

// Russian 5-point scale. Single source of truth for grade values, colours, labels.
export const GRADES: GradeLetter[] = ['5', '4', '3', '2']

// Score brackets, mirrored from the grading prompt in backend/src/services/grading.ts.
// [min, max] inclusive — same boundaries shown to the AI.
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

export function gradeColor(grade: string | null | undefined): string {
  switch (grade) {
    case '5': return 'var(--color-success)'
    case '4': return 'var(--color-amber)'
    case '3': return 'var(--color-warning)'
    case '2': return 'var(--color-danger)'
    default:  return 'var(--color-ink-tertiary)'
  }
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
