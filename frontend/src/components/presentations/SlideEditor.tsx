import { useState } from 'react'
import Button from '../ui/Button'
import type {
  Slide, TitleSlide, BulletsSlide, ConceptSlide, FormulaSlide,
  ComparisonSlide, DiagramSlide, DiscussionSlide, SummarySlide,
} from '../../types'

// In-place slide editing (TODO.md "### AO" Phase 1). Before this, a deck was
// immutable apart from swapping an image: one bad slide meant regenerating
// everything (rerolling the slides the teacher liked) or leaving for
// PowerPoint, which forks the deck out of ИСПУМ for good.
//
// One form per slide type rather than a shape-driven generic editor: the
// bodies are a discriminated union, and a generic editor would have to widen
// them to `unknown` to walk the fields — losing exactly the type safety that
// keeps a hand-edited slide renderable by the viewer and the PPTX exporter.
//
// The image is deliberately NOT edited here — it has its own picker, and
// duplicating it into a text form would give two controls over one field.

// String arrays edit as one-item-per-line text: teachers reorder and add
// bullets far more than they edit a single one in place, and per-item inputs
// with add/remove buttons make that the slowest possible path.
function linesToArray(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter(Boolean)
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-[11px] font-sans font-medium text-ink-secondary mb-1">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full px-2.5 py-1.5 text-sm font-sans text-ink bg-surface border border-border rounded-md ' +
  'focus:outline-none focus:border-border-strong'
const areaClass = `${inputClass} resize-y`

function Text({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
}

function Area({ value, onChange, rows = 3, placeholder }: { value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return <textarea className={areaClass} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
}

function Lines({ value, onChange, rows = 4 }: { value: string[]; onChange: (v: string[]) => void; rows?: number }) {
  return (
    <Area
      rows={rows}
      value={value.join('\n')}
      onChange={(v) => onChange(linesToArray(v))}
      placeholder="По одному пункту на строку"
    />
  )
}

interface Props {
  slide:   Slide
  onSave:  (slide: Slide) => void
  onCancel: () => void
  saving:  boolean
}

export default function SlideEditor({ slide, onSave, onCancel, saving }: Props) {
  const [draft, setDraft] = useState<Slide>(slide)

  // Body patches are per-type, so the cast is contained here rather than
  // spread through every field handler below.
  function patchBody<T extends Slide>(patch: Partial<T['body']>) {
    setDraft((d) => ({ ...d, body: { ...d.body, ...patch } }) as Slide)
  }

  return (
    <div className="p-4 space-y-3 bg-surface-warm border-t border-border">
      <Field label="Заголовок слайда">
        <Text value={draft.title} onChange={(title) => setDraft((d) => ({ ...d, title }))} />
      </Field>

      {renderBodyFields(draft, patchBody)}

      <Field label="Заметки докладчика">
        <Area rows={6} value={draft.notes} onChange={(notes) => setDraft((d) => ({ ...d, notes }))} />
      </Field>

      <div className="flex items-center gap-2 pt-1">
        <Button size="sm" onClick={() => onSave(draft)} loading={saving}>Сохранить</Button>
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>Отмена</Button>
      </div>
    </div>
  )
}

function renderBodyFields(
  draft: Slide,
  patch: <T extends Slide>(patch: Partial<T['body']>) => void,
): React.ReactNode {
  switch (draft.type) {
    case 'title': {
      const b = (draft as TitleSlide).body
      return (
        <>
          <Field label="Подзаголовок">
            <Text value={b.subtitle ?? ''} onChange={(subtitle) => patch<TitleSlide>({ subtitle })} />
          </Field>
          <Field label="Лектор">
            <Text value={b.lecturer ?? ''} onChange={(lecturer) => patch<TitleSlide>({ lecturer })} />
          </Field>
        </>
      )
    }
    case 'bullets': {
      const b = (draft as BulletsSlide).body
      return (
        <Field label="Тезисы">
          <Lines value={b.items} onChange={(items) => patch<BulletsSlide>({ items })} />
        </Field>
      )
    }
    case 'concept': {
      const b = (draft as ConceptSlide).body
      return (
        <>
          <Field label="Определение">
            <Area rows={3} value={b.definition} onChange={(definition) => patch<ConceptSlide>({ definition })} />
          </Field>
          <Field label="Уточнения">
            <Lines value={b.supporting} onChange={(supporting) => patch<ConceptSlide>({ supporting })} />
          </Field>
        </>
      )
    }
    case 'formula': {
      const b = (draft as FormulaSlide).body
      return (
        <>
          {b.formulas.map((f, i) => (
            <div key={i} className="grid grid-cols-2 gap-2">
              <Field label={`Формула ${i + 1} (LaTeX)`}>
                <Text
                  value={f.latex}
                  onChange={(latex) => patch<FormulaSlide>({
                    formulas: b.formulas.map((x, j) => (j === i ? { ...x, latex } : x)),
                  })}
                />
              </Field>
              <Field label="Подпись">
                <Text
                  value={f.caption}
                  onChange={(caption) => patch<FormulaSlide>({
                    formulas: b.formulas.map((x, j) => (j === i ? { ...x, caption } : x)),
                  })}
                />
              </Field>
            </div>
          ))}
          <Field label="Пояснение">
            {/* Blank writes back null, not "": the renderer tests this field
                for presence, and an empty string would reserve a line for
                nothing under the formula. */}
            <Area
              rows={3}
              value={b.explanation ?? ''}
              onChange={(explanation) => patch<FormulaSlide>({ explanation: explanation.trim() || null })}
            />
          </Field>
        </>
      )
    }
    case 'comparison': {
      const b = (draft as ComparisonSlide).body
      return (
        <div className="grid grid-cols-2 gap-3">
          {b.columns.map((col, i) => (
            <div key={i} className="space-y-2">
              <Field label={`Колонка ${i + 1} — заголовок`}>
                <Text
                  value={col.header}
                  onChange={(header) => patch<ComparisonSlide>({
                    columns: b.columns.map((x, j) => (j === i ? { ...x, header } : x)),
                  })}
                />
              </Field>
              <Field label="Пункты">
                <Lines
                  value={col.items}
                  onChange={(items) => patch<ComparisonSlide>({
                    columns: b.columns.map((x, j) => (j === i ? { ...x, items } : x)),
                  })}
                />
              </Field>
            </div>
          ))}
        </div>
      )
    }
    case 'diagram': {
      const b = (draft as DiagramSlide).body
      return (
        <>
          <Field label="Подпись под изображением">
            <Text value={b.caption} onChange={(caption) => patch<DiagramSlide>({ caption })} />
          </Field>
          <Field label="Пункты под изображением">
            <Lines value={b.points} rows={3} onChange={(points) => patch<DiagramSlide>({ points })} />
          </Field>
          <Field label="Поисковый запрос для изображения">
            <Text value={b.image_query} onChange={(image_query) => patch<DiagramSlide>({ image_query })} />
          </Field>
        </>
      )
    }
    case 'discussion': {
      const b = (draft as DiscussionSlide).body
      return (
        <>
          <Field label="Вопрос">
            <Area rows={2} value={b.question} onChange={(question) => patch<DiscussionSlide>({ question })} />
          </Field>
          <Field label="Подвопросы">
            <Lines value={b.prompts} rows={3} onChange={(prompts) => patch<DiscussionSlide>({ prompts })} />
          </Field>
          <Field label="Направления ответа">
            <Lines value={b.expected_angles} rows={3} onChange={(expected_angles) => patch<DiscussionSlide>({ expected_angles })} />
          </Field>
        </>
      )
    }
    case 'summary': {
      const b = (draft as SummarySlide).body
      return (
        <>
          <Field label="Выводы">
            <Lines value={b.takeaways} onChange={(takeaways) => patch<SummarySlide>({ takeaways })} />
          </Field>
          <Field label="Дальнейшие шаги">
            <Lines value={b.next_steps} rows={3} onChange={(next_steps) => patch<SummarySlide>({ next_steps })} />
          </Field>
        </>
      )
    }
  }
}
