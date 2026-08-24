import type { ConfidenceLevel, AiEnsemble } from '../../types'

// Visual language for the confidence label produced by "thorough" grading.
// high → green / reassuring; medium → neutral; low → warning ("check this").
const LEVEL: Record<ConfidenceLevel, { label: string; cls: string; icon: string }> = {
  high:   { label: 'Высокая уверенность',  cls: 'bg-success-bg text-success', icon: '✓' },
  medium: { label: 'Средняя уверенность',  cls: 'bg-amber-light text-amber',  icon: '≈' },
  low:    { label: 'Проверьте внимательно', cls: 'bg-warning-bg text-warning', icon: '⚠' },
}

function spreadHint(e: AiEnsemble | null | undefined): string | undefined {
  if (!e || e.samples.length < 2) return undefined
  const grades = e.samples.map((s) => s.grade).join(', ')
  const base = `Оценки вариантов модели: ${grades} · разброс баллов ${e.score_spread}`
  return e.reconciled && e.reconciliation_note
    ? `${base}\nИтоговый балл скорректирован: ${e.reconciliation_note}`
    : base
}

interface Props {
  level:     ConfidenceLevel
  ensemble?: AiEnsemble | null
  size?:     'sm' | 'md'
}

/**
 * Confidence chip. On its own it's just a labelled pill; pass `ensemble` to
 * expose the variant spread as a tooltip so the teacher can see *why* the
 * system is (un)sure.
 */
export default function ConfidenceBadge({ level, ensemble, size = 'md' }: Props) {
  const v = LEVEL[level]
  const pad = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
  return (
    <span
      className={`inline-flex items-center gap-1 font-sans font-medium rounded-sm ${pad} ${v.cls}`}
      title={spreadHint(ensemble)}
    >
      <span aria-hidden>{v.icon}</span>
      {v.label}
    </span>
  )
}
