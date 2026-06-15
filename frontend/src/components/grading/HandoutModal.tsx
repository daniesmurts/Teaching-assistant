import { useMemo, useState } from 'react'
import Button from '../ui/Button'
import { composeHandout } from '../../api/grading'
import { useUIStore } from '../../store/uiStore'
import type { BulletItem, VerificationQuestion } from '../../types'

type Tone = 'encouraging' | 'neutral' | 'direct'

interface Props {
  assignmentId:           string
  improvements:           BulletItem[]
  verificationQuestions:  VerificationQuestion[]
  onClose: () => void
}

/**
 * Modal: teacher picks which improvements + questions to send back to the
 * student, picks a tone, generates a handout via DeepSeek. The result is
 * editable (so the teacher can polish before sending), with copy buttons for
 * subject and body.
 *
 * Two question sources merge into one selectable list:
 *  - the per-bullet `question` on each improvement (#2)
 *  - the standalone verification questions (#1)
 */
export default function HandoutModal({
  assignmentId, improvements, verificationQuestions, onClose,
}: Props) {
  const addToast = useUIStore((s) => s.addToast)

  // Build the candidate question list once — verification questions first
  // (they're typically the meatiest), then per-bullet questions.
  const candidateQuestions = useMemo(() => {
    const out: string[] = []
    for (const q of verificationQuestions) if (q.question.trim()) out.push(q.question.trim())
    for (const b of improvements) if (b.question?.trim()) out.push(b.question.trim())
    // Dedupe while preserving order
    return Array.from(new Set(out))
  }, [improvements, verificationQuestions])

  const candidateImprovements = useMemo(
    () => improvements.map((b) => b.text.trim()).filter(Boolean),
    [improvements]
  )

  // Selection state — start with everything checked.
  const [selectedImprovements, setSelectedImprovements] = useState<Set<string>>(() => new Set(candidateImprovements))
  const [selectedQuestions, setSelectedQuestions]       = useState<Set<string>>(() => new Set(candidateQuestions))
  const [tone, setTone]   = useState<Tone>('neutral')

  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null)
  const [loading, setLoading] = useState(false)

  function toggle(set: Set<string>, setter: (s: Set<string>) => void, value: string) {
    const next = new Set(set)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setter(next)
  }

  async function generate() {
    if (selectedImprovements.size === 0 && selectedQuestions.size === 0) {
      addToast('Выберите хотя бы один пункт или вопрос', 'error')
      return
    }
    setLoading(true)
    try {
      const result = await composeHandout(assignmentId, {
        improvements: Array.from(selectedImprovements),
        questions:    Array.from(selectedQuestions),
        tone,
      })
      setDraft(result)
    } catch {
      // Interceptor shows the toast.
    } finally {
      setLoading(false)
    }
  }

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(
      () => addToast(`${label} скопировано`, 'success'),
      () => addToast('Не удалось скопировать', 'error'),
    )
  }

  const TONE_LABEL: Record<Tone, string> = {
    encouraging: 'Поддерживающий',
    neutral:     'Нейтральный',
    direct:      'Деловой',
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl w-full max-w-2xl my-8 shadow-sm border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="font-display text-lg font-bold text-ink">Доработка для студента</h2>
          <button onClick={onClose} className="text-ink-tertiary hover:text-ink text-lg leading-none" aria-label="Закрыть">×</button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {!draft ? (
            <>
              {/* Improvements selection */}
              {candidateImprovements.length > 0 && (
                <section>
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    Пункты для доработки ({selectedImprovements.size}/{candidateImprovements.length})
                  </div>
                  <div className="space-y-1.5">
                    {candidateImprovements.map((s) => (
                      <label key={s} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedImprovements.has(s)}
                          onChange={() => toggle(selectedImprovements, setSelectedImprovements, s)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
                        />
                        <span className="text-[13px] font-sans text-ink leading-relaxed">{s}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {/* Questions selection */}
              {candidateQuestions.length > 0 && (
                <section>
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    Вопросы к студенту ({selectedQuestions.size}/{candidateQuestions.length})
                  </div>
                  <div className="space-y-1.5">
                    {candidateQuestions.map((q) => (
                      <label key={q} className="flex items-start gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedQuestions.has(q)}
                          onChange={() => toggle(selectedQuestions, setSelectedQuestions, q)}
                          className="mt-0.5 h-3.5 w-3.5 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
                        />
                        <span className="text-[13px] font-sans text-ink leading-relaxed">{q}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              {candidateImprovements.length === 0 && candidateQuestions.length === 0 && (
                <p className="text-sm text-ink-secondary">
                  Для этой работы нет пунктов улучшения или вопросов, которые можно отправить студенту.
                </p>
              )}

              {/* Tone */}
              <section>
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                  Тон письма
                </div>
                <select
                  className={inputClass + ' py-2'}
                  value={tone}
                  onChange={(e) => setTone(e.target.value as Tone)}
                >
                  {(['encouraging', 'neutral', 'direct'] as Tone[]).map((t) => (
                    <option key={t} value={t}>{TONE_LABEL[t]}</option>
                  ))}
                </select>
              </section>

              <div className="flex gap-2 pt-1">
                <Button size="sm" loading={loading} onClick={generate}>Сгенерировать доработку</Button>
                <Button size="sm" variant="secondary" onClick={onClose}>Отмена</Button>
              </div>
            </>
          ) : (
            <>
              {/* Result — editable */}
              <section>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Тема</label>
                  <button onClick={() => copy(draft.subject, 'Тему')}
                    className="text-[11px] text-amber hover:underline">Копировать</button>
                </div>
                <input
                  type="text"
                  value={draft.subject}
                  onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                  className={inputClass + ' py-2'}
                />
              </section>
              <section>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Текст</label>
                  <button onClick={() => copy(draft.body, 'Текст')}
                    className="text-[11px] text-amber hover:underline">Копировать</button>
                </div>
                <textarea
                  rows={14}
                  value={draft.body}
                  onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                  className={inputClass + ' leading-relaxed resize-y'}
                />
              </section>
              <div className="flex gap-2 pt-1">
                <Button size="sm" variant="secondary" onClick={() => setDraft(null)}>← Изменить выбор</Button>
                <Button size="sm" onClick={onClose}>Готово</Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
