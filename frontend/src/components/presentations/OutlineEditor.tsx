import { useState } from 'react'
import Button from '../ui/Button'
import Select from '../ui/Select'
import { MAX_SLIDE_COUNT } from '../../types'
import type { PresentationOutlineSlide, SlideType } from '../../types'

// The approval gate (TODO.md "### AO" Phase 0). The outline pass costs one
// LLM call and lands in seconds; expansion costs ~one call per five slides
// and runs for minutes. This is the seam between them: the teacher sees the
// plan while it is still cheap to change, and «Продолжить» is what spends
// the rest.
//
// Deliberately edits structure only — title, type, order, which slides exist.
// Slide *content* editing is Phase 1; putting a body editor here would ask
// the teacher to write the deck themselves, which is the opposite of the point.

const TYPE_OPTIONS: Array<{ value: SlideType; label: string }> = [
  { value: 'title',      label: 'Титул' },
  { value: 'bullets',    label: 'Тезисы' },
  { value: 'concept',    label: 'Понятие' },
  { value: 'formula',    label: 'Формула' },
  { value: 'comparison', label: 'Сравнение' },
  { value: 'diagram',    label: 'Схема' },
  { value: 'discussion', label: 'Обсуждение' },
  { value: 'summary',    label: 'Итоги' },
]

const BLANK: PresentationOutlineSlide = { type: 'bullets', title: '', brief: '' }

interface Props {
  outline:   PresentationOutlineSlide[]
  onConfirm: (outline: PresentationOutlineSlide[]) => void
  onCancel:  () => void
  confirming: boolean
  error?:    string
}

export default function OutlineEditor({ outline, onConfirm, onCancel, confirming, error }: Props) {
  const [rows, setRows] = useState<PresentationOutlineSlide[]>(outline)

  function update(i: number, patch: Partial<PresentationOutlineSlide>) {
    setRows((r) => r.map((row, j) => (j === i ? { ...row, ...patch } : row)))
  }

  function remove(i: number) {
    setRows((r) => r.filter((_, j) => j !== i))
  }

  // Swap rather than splice — keeps the moved row's identity obvious to the
  // teacher (it trades places with its neighbour, nothing else shifts).
  function move(i: number, delta: number) {
    const j = i + delta
    setRows((r) => {
      if (j < 0 || j >= r.length) return r
      const next = [...r]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function insertAfter(i: number) {
    setRows((r) => [...r.slice(0, i + 1), { ...BLANK }, ...r.slice(i + 1)])
  }

  const usable = rows.filter((r) => r.title.trim().length > 0)
  const canConfirm = usable.length > 0 && !confirming

  return (
    <div className="bg-surface border border-border rounded-lg p-5 space-y-4 result-appear">
      <div>
        <h3 className="font-sans text-sm font-medium text-ink">План лекции</h3>
        <p className="font-sans text-xs text-ink-secondary mt-1 max-w-[62ch]">
          Проверьте структуру до того, как ИСПУМ напишет слайды и заметки: порядок,
          тип и состав слайдов сейчас поменять быстро, после генерации — долго.
          Содержание каждого слайда будет написано по его заголовку и описанию.
        </p>
      </div>

      <div className="border border-border rounded-md overflow-hidden">
        {rows.map((row, i) => (
          <div
            key={i}
            className="grid grid-cols-[28px_150px_1fr_auto] gap-2 items-start px-3 py-2.5 border-b border-border last:border-0"
          >
            <div className="font-sans text-xs text-ink-tertiary pt-2.5 tabular-nums">{i + 1}</div>

            <div className="pt-1">
              <Select
                size="sm"
                value={row.type}
                onChange={(v) => update(i, { type: v as SlideType })}
                options={TYPE_OPTIONS}
                ariaLabel={`Тип слайда ${i + 1}`}
              />
            </div>

            <div className="space-y-1.5">
              <input
                value={row.title}
                onChange={(e) => update(i, { title: e.target.value })}
                placeholder="Заголовок слайда"
                aria-label={`Заголовок слайда ${i + 1}`}
                className="w-full px-2.5 py-1.5 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
              />
              <textarea
                value={row.brief}
                onChange={(e) => update(i, { brief: e.target.value })}
                placeholder="Что раскрыть на слайде — конкретно, а не «рассказать про…»"
                aria-label={`Описание слайда ${i + 1}`}
                rows={2}
                className="w-full px-2.5 py-1.5 text-xs font-sans text-ink-secondary bg-surface border border-border rounded-md resize-y focus:outline-none focus:border-border-strong"
              />
            </div>

            <div className="flex items-center gap-0.5 pt-1">
              <IconButton label="Выше"  disabled={i === 0}              onClick={() => move(i, -1)}>↑</IconButton>
              <IconButton label="Ниже"  disabled={i === rows.length - 1} onClick={() => move(i, +1)}>↓</IconButton>
              <IconButton label="Добавить слайд ниже" disabled={rows.length >= MAX_SLIDE_COUNT} onClick={() => insertAfter(i)}>+</IconButton>
              <IconButton label="Удалить слайд" onClick={() => remove(i)} danger>×</IconButton>
            </div>
          </div>
        ))}

        {rows.length === 0 && (
          <div className="px-3 py-6 text-center font-sans text-xs text-ink-secondary">
            План пуст — добавьте хотя бы один слайд.
          </div>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setRows((r) => [...r, { ...BLANK }])}
          disabled={rows.length >= MAX_SLIDE_COUNT}
          className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors disabled:opacity-40 disabled:hover:text-ink-secondary"
        >
          + Добавить слайд
        </button>
        <div className="font-sans text-xs text-ink-tertiary">
          Слайдов: {usable.length}
          {usable.length !== rows.length && ` (${rows.length - usable.length} без заголовка — не войдут)`}
        </div>
      </div>

      {error && (
        <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">{error}</div>
      )}

      <div className="flex items-center gap-2">
        <Button onClick={() => onConfirm(usable)} loading={confirming} disabled={!canConfirm}>
          Написать слайды
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={confirming}>
          Отменить
        </Button>
        {confirming && (
          <span className="font-sans text-xs text-ink-secondary">
            Пишем текст слайдов и заметки — это занимает несколько минут.
          </span>
        )}
      </div>
    </div>
  )
}

function IconButton({
  children, label, onClick, disabled, danger,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={
        'w-6 h-6 flex items-center justify-center rounded-sm text-sm leading-none transition-colors ' +
        'disabled:opacity-30 disabled:cursor-default ' +
        (danger
          ? 'text-ink-tertiary hover:text-danger hover:bg-danger-bg'
          : 'text-ink-tertiary hover:text-ink hover:bg-surface-warm')
      }
    >
      {children}
    </button>
  )
}
