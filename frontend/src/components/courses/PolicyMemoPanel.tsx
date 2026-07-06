import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getPolicyMemo, regeneratePolicyMemo } from '../../api/courses'
import Button from '../ui/Button'
import { useUIStore } from '../../store/uiStore'

interface Props {
  courseId: string
}

/**
 * Shows the distilled per-course grading-policy memo (patterns in how this
 * teacher's approvals diverge from the AI draft) with a manual regenerate
 * button. The memo is also regenerated automatically every ~10 approvals —
 * this panel is for an on-demand refresh + visibility into what's currently
 * feeding the grading prompt.
 */
export default function PolicyMemoPanel({ courseId }: Props) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data: memo, isLoading } = useQuery({
    queryKey: ['policy-memo', courseId],
    queryFn: () => getPolicyMemo(courseId),
  })

  const regenerateMut = useMutation({
    mutationFn: () => regeneratePolicyMemo(courseId),
    onSuccess: (updated) => {
      qc.setQueryData(['policy-memo', courseId], updated)
      addToast(updated ? 'Профиль оценивания обновлён' : 'Пока недостаточно данных для профиля', updated ? 'success' : 'error')
    },
    onError: () => addToast('Не удалось обновить профиль оценивания', 'error'),
  })

  return (
    <div className="bg-surface-warm border border-border rounded-md p-3">
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-xs font-sans font-semibold text-ink uppercase tracking-wide">
          Профиль оценивания
        </span>
        <Button size="sm" variant="secondary" loading={regenerateMut.isPending} onClick={() => regenerateMut.mutate()}>
          Обновить
        </Button>
      </div>
      {isLoading ? (
        <p className="text-xs font-sans text-ink-tertiary">Загрузка…</p>
      ) : memo ? (
        <>
          <p className="text-xs font-sans text-ink-secondary leading-relaxed">{memo.memo_text}</p>
          <p className="text-[11px] font-sans text-ink-tertiary mt-1.5">
            На основе {memo.based_on_count} проверенных работ · обновлено{' '}
            {new Date(memo.generated_at).toLocaleDateString('ru-RU')}
          </p>
        </>
      ) : (
        <p className="text-xs font-sans text-ink-tertiary leading-relaxed">
          Пока недостаточно проверенных и утверждённых работ по предмету, чтобы выявить устойчивые
          закономерности в вашем оценивании. Профиль появится автоматически после нескольких утверждений.
        </p>
      )}
    </div>
  )
}
