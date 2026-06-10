import type { GradeLetter } from '../types'

// Russian 5-point scale. Single source of truth for grade values, colours, labels.
export const GRADES: GradeLetter[] = ['5', '4', '3', '2']

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
