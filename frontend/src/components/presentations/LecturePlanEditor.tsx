import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../ui/Button'
import { saveLecturePlan } from '../../api/courses'
import { useUIStore } from '../../store/uiStore'
import type { LectureTopic } from '../../types'

// Правка тематического плана (TODO.md "### AO" Phase 3 follow-up).
//
// The plan is read out of the РПД by a model, and a model reading a Word table
// gets things wrong: a merged cell becomes one тема, a practical gets counted
// as a lecture, the wording is abbreviated. `PUT /api/courses/:id/lecture-plan`
// has existed since the extraction shipped and nothing ever called it — so the
// only fix for one wrong line was re-extracting the whole plan and hoping.
//
// Edits are saved as a whole list, matching the endpoint: positions are
// renumbered server-side, so the client never has to reconcile them.

interface Props {
  courseId: string
  topics:   LectureTopic[]
  onClose:  () => void
}

interface Row { title: string; description: string }

export default function LecturePlanEditor({ courseId, topics, onClose }: Props) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [rows, setRows] = useState<Row[]>(
    topics.map((t) => ({ title: t.title, description: t.description ?? '' })),
  )

  const saveMut = useMutation({
    mutationFn: () => saveLecturePlan(courseId, rows.filter((r) => r.title.trim())),
    onSuccess: (saved) => {
      qc.setQueryData(['lecture-plan', courseId], saved)
      addToast(`План сохранён: ${saved.length} тем`, 'success')
      onClose()
    },
    onError: (err: unknown) => {
      const message = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      addToast(message ?? 'Не удалось сохранить план', 'error')
    },
  })

  const update = (i: number, patch: Partial<Row>) =>
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  const remove = (i: number) => setRows((r) => r.filter((_, j) => j !== i))
  const move = (i: number, delta: number) =>
    setRows((r) => {
      const j = i + delta
      if (j < 0 || j >= r.length) return r
      const next = [...r]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const usable = rows.filter((r) => r.title.trim()).length

  return (
    <div className="bg-surface-warm border border-border rounded-md px-3 py-3 space-y-3">
      <div>
        <div className="text-xs font-sans font-medium text-ink">Тематический план предмета</div>
        <p className="text-[11px] font-sans text-ink-tertiary mt-0.5 max-w-[62ch]">
          Разбор РПД делает ИСПУМ, и в таблице программы он иногда ошибается — здесь план можно
          поправить руками. Номер темы = номер лекции, порядок задаётся здесь.
        </p>
      </div>

      <div className="border border-border rounded-md overflow-hidden bg-surface">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-[24px_1fr_auto] gap-2 items-start px-2.5 py-2 border-b border-border last:border-0">
            <div className="font-sans text-[11px] text-ink-tertiary pt-2 tabular-nums">{i + 1}</div>
            <div className="space-y-1">
              <input
                value={row.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Название темы"
                aria-label={`Тема ${i + 1}`}
                className="w-full px-2 py-1.5 text-sm font-sans text-ink bg-surface border border-border rounded-md outline-none focus:border-border-strong"
              />
              <input
                value={row.description}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="Краткое содержание по программе (необязательно)"
                aria-label={`Содержание темы ${i + 1}`}
                className="w-full px-2 py-1.5 text-xs font-sans text-ink-secondary bg-surface border border-border rounded-md outline-none focus:border-border-strong"
              />
            </div>
            <div className="flex items-center gap-0.5 pt-1">
              <PlanBtn label="Выше" disabled={i === 0} onClick={() => move(i, -1)}>↑</PlanBtn>
              <PlanBtn label="Ниже" disabled={i === rows.length - 1} onClick={() => move(i, +1)}>↓</PlanBtn>
              <PlanBtn label="Удалить тему" danger onClick={() => remove(i)}>×</PlanBtn>
            </div>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="px-3 py-5 text-center text-xs font-sans text-ink-tertiary">
            План пуст — добавьте тему или разберите РПД заново.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { title: '', description: '' }])}
          className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors"
        >
          + Добавить тему
        </button>
        <span className="text-[11px] font-sans text-ink-tertiary">
          Тем: {usable}{usable !== rows.length && ` (${rows.length - usable} без названия — не сохранятся)`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button type="button" size="sm" loading={saveMut.isPending} disabled={usable === 0} onClick={() => saveMut.mutate()}>
          Сохранить план
        </Button>
        <Button type="button" size="sm" variant="secondary" onClick={onClose} disabled={saveMut.isPending}>
          Отмена
        </Button>
      </div>
    </div>
  )
}

function PlanBtn({ children, label, onClick, disabled, danger }: {
  children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        'w-7 h-7 flex items-center justify-center rounded-sm text-sm leading-none transition-colors ' +
        'disabled:opacity-30 disabled:cursor-default ' +
        (danger ? 'text-ink-tertiary hover:text-danger hover:bg-danger-bg' : 'text-ink-tertiary hover:text-ink hover:bg-surface-warm')
      }
    >
      {children}
    </button>
  )
}
