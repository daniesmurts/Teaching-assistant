import { gradeColor } from '../../lib/grades'
import type { TrajectoryEntry } from '../../api/grading'
import type { GradeLetter, CriterionScore } from '../../types'

interface Props {
  loading: boolean
  entries: TrajectoryEntry[]              // newest-first, current assignment excluded
  currentScore: number
  currentGrade: GradeLetter
  currentCriteriaScores: CriterionScore[]
}

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })

const normaliseName = (name: string) => name.trim().toLowerCase()

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--color-success)'
  if (score >= 55) return 'var(--color-amber)'
  return 'var(--color-danger)'
}

/** Per-criterion movement: current score vs. the most recent prior score for the same criterion name. */
function buildMovement(entries: TrajectoryEntry[], current: CriterionScore[]) {
  return current.map((c) => {
    const key = normaliseName(c.name)
    for (const entry of entries) {
      const prior = entry.criteria_scores?.find((p) => normaliseName(p.name) === key)
      if (prior) return { name: c.name, current: c.score, previous: prior.score, delta: c.score - prior.score }
    }
    return { name: c.name, current: c.score, previous: null, delta: null }
  })
}

export default function StudentTrajectory({ loading, entries, currentScore, currentGrade, currentCriteriaScores }: Props) {
  if (loading) {
    return <p className="text-sm font-sans text-ink-secondary">Загрузка истории…</p>
  }

  if (entries.length === 0) {
    return (
      <p className="text-sm font-sans text-ink-secondary">
        Это первая проверенная вами работа этого студента — истории пока нет. Она появится начиная со следующей проверки.
      </p>
    )
  }

  const movement = buildMovement(entries, currentCriteriaScores)

  return (
    <div className="space-y-5">
      <div>
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Последние работы
        </div>
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div key={e.id} className="flex items-center gap-2.5 text-sm font-sans">
              <span className="text-ink-tertiary text-xs w-14 flex-shrink-0">{fmt(e.created_at)}</span>
              {e.grade != null && (
                <span className="font-display font-bold w-5 text-center flex-shrink-0" style={{ color: gradeColor(e.grade) }}>
                  {e.grade}
                </span>
              )}
              <span className="text-ink-secondary text-xs">{e.score ?? '—'} баллов</span>
            </div>
          ))}
          {/* Current, unsaved result — shown as the newest point for context */}
          <div className="flex items-center gap-2.5 text-sm font-sans pt-1 border-t border-border mt-1.5">
            <span className="text-amber text-xs w-14 flex-shrink-0 font-medium">сейчас</span>
            <span className="font-display font-bold w-5 text-center flex-shrink-0" style={{ color: gradeColor(currentGrade) }}>
              {currentGrade}
            </span>
            <span className="text-ink text-xs font-medium">{Number.isNaN(currentScore) ? '—' : currentScore} баллов</span>
            {!Number.isNaN(currentScore) && entries[0]?.score != null && currentScore !== entries[0].score && (
              <span
                className="text-[11px] font-sans font-semibold"
                style={{ color: currentScore > entries[0].score ? 'var(--color-success)' : 'var(--color-danger)' }}
              >
                {currentScore > entries[0].score ? '+' : ''}{currentScore - entries[0].score}
              </span>
            )}
          </div>
        </div>
      </div>

      {movement.length > 0 && (
        <div>
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Движение по критериям
          </div>
          <div className="space-y-2.5">
            {movement.map((m) => (
              <div key={m.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-sans text-ink">{m.name}</span>
                  <span className="text-xs font-sans text-ink-secondary flex items-center gap-1.5">
                    {m.previous != null ? (
                      <>
                        {m.previous} → {m.current}
                        {m.delta !== 0 && (
                          <span className="font-semibold" style={{ color: (m.delta ?? 0) > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            {(m.delta ?? 0) > 0 ? '+' : ''}{m.delta}
                          </span>
                        )}
                      </>
                    ) : (
                      <span className="text-ink-tertiary">впервые</span>
                    )}
                  </span>
                </div>
                <div className="h-1 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{ width: `${m.current}%`, backgroundColor: scoreColor(m.current) }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
