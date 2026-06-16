import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { updateCourse } from '../../api/courses'
import Button from '../ui/Button'
import { useUIStore } from '../../store/uiStore'
import type { Course } from '../../types'

const CONSENT_KEY = 'ga_consent_shared_rag'

interface Props {
  course: Course
}

/**
 * Per-course "поделиться с кафедрой" toggle. Only meaningful when the teacher's
 * institution has the master toggle on (gated at the parent — this component
 * assumes it's safe to render).
 *
 * First time a teacher flips it ON for any course, we show a confirmation
 * dialog naming what gets shared and the anonymisation caveat. Subsequent
 * toggles flip without the dialog (consent decision is per-teacher, persisted
 * in localStorage).
 */
export default function ShareRagToggle({ course }: Props) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [confirming, setConfirming] = useState(false)

  const mut = useMutation({
    mutationFn: (next: boolean) =>
      updateCourse(course.id, { share_rag_with_institution: next }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ['courses'] })
      addToast(
        updated.share_rag_with_institution
          ? `«${course.name}» теперь делится с кафедрой`
          : `«${course.name}» снято с общего цикла`,
        'success'
      )
    },
    onError: () => addToast('Не удалось изменить настройку', 'error'),
  })

  function alreadyConsented(): boolean {
    try { return localStorage.getItem(CONSENT_KEY) === '1' } catch { return false }
  }
  function markConsented() {
    try { localStorage.setItem(CONSENT_KEY, '1') } catch { /* noop */ }
  }

  function attemptFlip() {
    const turningOn = !course.share_rag_with_institution
    if (turningOn && !alreadyConsented()) {
      setConfirming(true)
    } else {
      mut.mutate(turningOn)
    }
  }

  function confirmAndFlip() {
    markConsented()
    setConfirming(false)
    mut.mutate(true)
  }

  return (
    <>
      <button
        type="button"
        onClick={attemptFlip}
        disabled={mut.isPending}
        title={
          course.share_rag_with_institution
            ? 'Снять с общего цикла кафедры'
            : 'Поделиться этим предметом с кафедрой'
        }
        className={`text-[11px] font-sans font-medium px-2 py-1 rounded-sm border transition-colors ${
          course.share_rag_with_institution
            ? 'bg-info-bg text-info border-info/30 hover:bg-info-bg/80'
            : 'bg-surface text-ink-secondary border-border hover:border-info/40'
        } ${mut.isPending ? 'opacity-50 cursor-wait' : ''}`}
      >
        {course.share_rag_with_institution ? '✦ С кафедрой' : '+ Поделиться'}
      </button>

      {confirming && (
        <ConsentDialog
          courseName={course.name}
          onConfirm={confirmAndFlip}
          onCancel={() => setConfirming(false)}
        />
      )}
    </>
  )
}

// ─── Consent dialog ──────────────────────────────────────────────────────────

function ConsentDialog({
  courseName, onConfirm, onCancel,
}: { courseName: string; onConfirm: () => void; onCancel: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4" onClick={onCancel}>
      <div
        className="bg-surface rounded-xl w-full max-w-md border border-border overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 pt-6 pb-5">
          <h2 className="font-display text-xl font-bold text-ink tracking-tight mb-2">
            Поделиться предметом с кафедрой
          </h2>
          <p className="font-sans text-sm text-ink-secondary leading-relaxed mb-4">
            Когда «{courseName}» включён в общий цикл, ваши <strong>утверждённые проверки</strong>{' '}
            становятся образцом для ИИ при оценке работ ваших коллег по этому же предмету. И наоборот —
            при ваших проверках ИИ будет опираться на их решения.
          </p>

          <div className="bg-amber-light/40 border border-amber/20 rounded-md p-3 mb-4">
            <div className="text-xs font-sans font-semibold text-amber mb-1.5 uppercase tracking-wide">
              Что именно передаётся
            </div>
            <ul className="text-xs font-sans text-ink-secondary leading-relaxed space-y-1">
              <li>· Тексты утверждённых работ — с автоматической попыткой убрать ФИО студентов</li>
              <li>· Ваши итоговые оценки, баллы и общий отзыв</li>
              <li>· Внутри одной кафедры — никуда за её пределы и никогда за пределы РФ</li>
            </ul>
          </div>

          <div className="text-xs font-sans text-ink-tertiary leading-relaxed mb-1">
            Обезличивание работает по типичным шаблонам ФИО — но это «лучшая попытка», не гарантия.{' '}
            Если в работе встречается имя в нестандартной форме, оно может попасть в общий пул.{' '}
            Вы можете отключить совместное использование в любой момент.
          </div>
        </div>

        <div className="flex gap-2 px-6 py-4 border-t border-border">
          <Button onClick={onConfirm} className="flex-1">
            Согласен, делиться
          </Button>
          <Button variant="secondary" onClick={onCancel}>
            Отмена
          </Button>
        </div>
      </div>
    </div>
  )
}
