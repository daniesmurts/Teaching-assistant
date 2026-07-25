// Russian 5-point scale — frontend entry point.
//
// The scale itself (brackets, score↔grade conversion, labels) now lives in
// shared/grades.ts so the backend enforces the *same* boundaries it states in
// the grading prompt, instead of the two sides mirroring the numbers by hand.
// Re-exported here so existing call sites keep importing from one place.
export { GRADES, GRADE_BRACKETS, scoreToGrade, snapScoreToGrade, gradeLabel } from '../../../shared/grades'

/** Presentation-only — maps a grade onto the design system's CSS variables. */
export function gradeColor(grade: string | null | undefined): string {
  switch (grade) {
    case '5': return 'var(--color-success)'
    case '4': return 'var(--color-amber)'
    case '3': return 'var(--color-warning)'
    case '2': return 'var(--color-danger)'
    default:  return 'var(--color-ink-tertiary)'
  }
}
