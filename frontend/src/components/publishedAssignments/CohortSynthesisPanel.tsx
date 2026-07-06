import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getCohortSynthesis, synthesizeCohort } from '../../api/publishedAssignments'
import Button from '../ui/Button'
import { useUIStore } from '../../store/uiStore'

interface Props {
  publishedAssignmentId: string
  submittedCount: number
}

/**
 * Class-wide insight over one published assignment's graded submissions:
 * recurring gaps, grade spread, standout strengths, suggested lecture topics.
 * Regenerated on demand — not automatic, since cost scales with cohort size.
 * The exact "enough approved work?" gate lives server-side (submitted !=
 * approved — a submission can be sent but not yet reviewed); errors surface
 * via toast with the precise shortfall.
 */
export default function CohortSynthesisPanel({ publishedAssignmentId, submittedCount }: Props) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data: synthesis, isLoading } = useQuery({
    queryKey: ['cohort-synthesis', publishedAssignmentId],
    queryFn: () => getCohortSynthesis(publishedAssignmentId),
  })

  const synthesizeMut = useMutation({
    mutationFn: () => synthesizeCohort(publishedAssignmentId),
    onSuccess: (result) => {
      qc.setQueryData(['cohort-synthesis', publishedAssignmentId], result)
      addToast('Аналитика по группе обновлена', 'success')
    },
    onError: (e: any) => addToast(e?.response?.data?.error ?? 'Не удалось построить аналитику', 'error'),
  })

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="font-display text-lg font-bold text-ink">Аналитика по группе</h2>
        <Button
          size="sm"
          variant="secondary"
          loading={synthesizeMut.isPending}
          onClick={() => synthesizeMut.mutate()}
        >
          {synthesis ? 'Обновить' : 'Построить анализ'}
        </Button>
      </div>

      {isLoading ? (
        <p className="text-sm font-sans text-ink-tertiary">Загрузка…</p>
      ) : !synthesis ? (
        <p className="text-sm font-sans text-ink-tertiary">
          Пока не построено. Сдано {submittedCount} работ — как только утверждённых будет достаточно,
          «Построить анализ» найдёт общие пробелы и темы для повторения.
        </p>
      ) : (
        <div className="space-y-4">
          {synthesis.common_gaps.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1.5">
                Частые пробелы
              </h3>
              <ul className="space-y-1">
                {synthesis.common_gaps.map((g, i) => (
                  <li key={i} className="text-sm font-sans text-ink-secondary flex items-baseline gap-2">
                    <span className="text-ink">{g.issue}</span>
                    <span className="text-xs text-ink-tertiary flex-shrink-0">×{g.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {synthesis.score_distribution.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1.5">
                Распределение оценок
              </h3>
              <div className="flex gap-3">
                {synthesis.score_distribution.map((d) => (
                  <span key={d.grade} className="text-sm font-sans text-ink-secondary">
                    <span className="font-medium text-ink">{d.grade}</span>: {d.count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {synthesis.standout_strengths.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1.5">
                Сильные стороны группы
              </h3>
              <ul className="space-y-1">
                {synthesis.standout_strengths.map((s, i) => (
                  <li key={i} className="text-sm font-sans text-ink-secondary">{s}</li>
                ))}
              </ul>
            </div>
          )}

          {synthesis.recommended_topics.length > 0 && (
            <div>
              <h3 className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1.5">
                Что стоит повторить на лекции
              </h3>
              <ul className="space-y-1">
                {synthesis.recommended_topics.map((t, i) => (
                  <li key={i} className="text-sm font-sans text-ink-secondary">{t}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-[11px] font-sans text-ink-tertiary">
            На основе {synthesis.based_on_count} работ · обновлено {new Date(synthesis.generated_at).toLocaleDateString('ru-RU')}
          </p>
        </div>
      )}
    </div>
  )
}
