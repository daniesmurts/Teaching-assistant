import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Badge from '../ui/Badge'
import RevisionCheckList from './RevisionCheckList'
import QuestionResponseList from './QuestionResponseList'
import ConfidenceBadge from './ConfidenceBadge'
import { getReviewByAssignment } from '../../api/grading'
import { gradeColor } from '../../lib/grades'
import type { Assignment, GradeLetter, AssignmentStatus, BulletItem, DefenseQuestion, ChapterReview, VerificationQuestion, Handout } from '../../types'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'

interface Props {
  assignment: Assignment
  onClose: () => void
}

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
function scoreColor(s: number): string {
  if (s >= 75) return 'var(--color-success)'
  if (s >= 55) return 'var(--color-amber)'
  return 'var(--color-danger)'
}

export default function AssignmentDetailModal({ assignment: a, onClose }: Props) {
  const navigate = useNavigate()
  const { can } = usePlan()
  const [openChapter, setOpenChapter] = useState<number | null>(0)
  const [showText, setShowText]       = useState(false)

  function gradeRevision() {
    onClose()
    navigate(`/grading?revision_of=${a.id}`)
  }

  // Open this pending assignment in the grading view to finish reviewing &
  // approving it — used when the page was refreshed/closed before approval.
  function resumeApproval() {
    onClose()
    navigate(`/grading?resume=${a.id}`)
  }

  // A long review may sit behind this assignment — fetch it (null for normal grades).
  const { data: review } = useQuery({
    queryKey: ['assignment-review', a.id],
    queryFn: () => getReviewByAssignment(a.id),
  })
  const r = review?.result ?? null

  const grade    = (a.approved_grade ?? a.ai_grade) as GradeLetter | null
  const score    = a.approved_score ?? a.ai_score
  const feedback = a.approved_feedback ?? a.ai_feedback
  const color    = gradeColor(grade)

  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl w-full max-w-2xl my-8 shadow-sm border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
          {grade && (
            <div className="font-display text-4xl font-bold leading-none" style={{ color }}>{grade}</div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-0.5">
              {score != null && <span className="text-sm font-sans font-medium text-ink">{score}/100</span>}
              {a.ai_grade_label && <span className="text-xs font-sans text-ink-secondary">{a.ai_grade_label}</span>}
              {review && (
                <span className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">
                  Рецензия ВКР
                </span>
              )}
              {a.revision_number > 1 && (
                <span
                  className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm"
                  title="Эта работа — переработка предыдущей версии"
                >
                  ↻ Переработка №{a.revision_number}
                </span>
              )}
              {a.ai_handout && (
                <span
                  className="text-[10px] font-sans font-medium bg-info-bg text-info px-1.5 py-0.5 rounded-sm"
                  title={`Текст доработки сформирован ${new Date(a.ai_handout.created_at).toLocaleDateString('ru-RU')} · ${a.ai_handout.improvements.length} пункт(ов), ${a.ai_handout.questions.length} вопрос(ов)`}
                >
                  ✦ Доработка
                </span>
              )}
              {a.ai_confidence && (
                <ConfidenceBadge level={a.ai_confidence} ensemble={a.ai_ensemble} size="sm" />
              )}
            </div>
            <div className="text-xs font-sans text-ink-tertiary">
              {fmt(a.created_at)}
              {a.student_name && <span> · {a.student_name}</span>}
              {a.student_group && <span> · {a.student_group}</span>}
            </div>
          </div>
          <Badge variant={a.status as AssignmentStatus} />
          {a.status === 'pending' && (
            <button
              onClick={resumeApproval}
              className="text-xs font-sans font-medium px-3 py-1.5 rounded-md bg-amber text-white hover:opacity-90 transition-opacity flex-shrink-0"
              title="Открыть в режиме проверки и подтвердить оценку"
            >
              Подтвердить оценку
            </button>
          )}
          {(a.status === 'approved' || a.status === 'sent') && (
            <button
              onClick={gradeRevision}
              className="text-xs font-sans font-medium px-3 py-1.5 rounded-md bg-amber text-white hover:opacity-90 transition-opacity flex-shrink-0"
              title="Открыть форму проверки для переработанной версии"
            >
              ↻ Оценить переработку
            </button>
          )}
          <button
            onClick={onClose}
            className="text-ink-tertiary hover:text-ink transition-colors text-lg leading-none ml-1"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>

        <div className="px-5 py-4 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Feedback */}
          {feedback && (
            <section>
              <Label>{review ? 'Общее заключение' : 'Отзыв'}</Label>
              <p className="text-[13px] font-sans text-ink-secondary leading-relaxed whitespace-pre-line">{feedback}</p>
            </section>
          )}

          {/* Revision check — only present when this was graded as a revision */}
          {a.ai_revision_check && a.ai_revision_check.length > 0 && (
            <RevisionCheckList items={a.ai_revision_check} />
          )}

          {a.ai_question_responses && a.ai_question_responses.length > 0 && (
            <QuestionResponseList items={a.ai_question_responses} />
          )}

          {/* Handout snapshot — only present when the teacher composed one for
              this work. Collapsed by default; expanding reveals the saved
              subject + body and a copy button. */}
          {a.ai_handout && (
            <HandoutSnapshot handout={a.ai_handout} />
          )}

          {/* Strengths / improvements — prefer teacher-edited values when present */}
          {(() => {
            const strengths    = a.approved_strengths    ?? a.ai_strengths    ?? []
            const improvements = a.approved_improvements ?? a.ai_improvements ?? []
            if (!strengths.length && !improvements.length) return null
            return (
              <div className="grid grid-cols-2 gap-2.5">
                <ReadOnlyBulletList title="Сильные стороны" items={strengths} tone="success" />
                <ReadOnlyBulletList title="Что улучшить"    items={improvements} tone="warning" />
              </div>
            )
          })()}

          {/* Criteria (normal grades) */}
          {(a.ai_criteria_scores?.length ?? 0) > 0 && (
            <section>
              <Label>Критерии</Label>
              <div className="space-y-3">
                {a.ai_criteria_scores!.map((cs) => (
                  <div key={cs.name}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-sans font-medium text-ink">{cs.name}</span>
                      <span className="text-sm font-sans text-ink-secondary">{cs.score}/100</span>
                    </div>
                    <div className="h-1 bg-border rounded-full overflow-hidden mb-1.5">
                      <div className="h-full rounded-full" style={{ width: `${cs.score}%`, backgroundColor: scoreColor(cs.score) }} />
                    </div>
                    <p className="text-xs font-sans text-ink-secondary leading-relaxed">{cs.feedback}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Chapter-by-chapter (ВКР review) */}
          {r && r.chapter_reviews.length > 0 && (
            <section>
              <Label>Разбор по разделам ({r.chapter_reviews.length})</Label>
              <div className="space-y-2">
                {r.chapter_reviews.map((c, i) => {
                  const open = openChapter === i
                  return (
                    <div key={i} className="border border-border rounded-lg overflow-hidden">
                      <button
                        onClick={() => setOpenChapter(open ? null : i)}
                        className="w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-warm transition-colors"
                      >
                        <span className="text-sm font-sans font-medium text-ink pr-2">{c.title || `Раздел ${i + 1}`}</span>
                        <span className="text-ink-tertiary text-xs flex-shrink-0">{open ? '−' : '+'}</span>
                      </button>
                      {open && (
                        <div className="px-3 pb-3 pt-1 space-y-2.5">
                          <p className="text-[13px] font-sans text-ink-secondary leading-relaxed whitespace-pre-line">{c.assessment}</p>
                          {c.strengths.length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold text-success uppercase tracking-wide mb-1">Плюсы</div>
                              {c.strengths.map((s) => (
                                <div key={s} className="flex gap-1.5 text-xs text-ink-secondary mb-0.5 leading-relaxed">
                                  <span className="text-success flex-shrink-0">+</span><span>{s}</span>
                                </div>
                              ))}
                            </div>
                          )}
                          {c.gaps.length > 0 && (
                            <div>
                              <div className="text-[10px] font-semibold text-warning uppercase tracking-wide mb-1">Замечания</div>
                              {c.gaps.map((g) => (
                                <div key={g} className="flex gap-1.5 text-xs text-ink-secondary mb-0.5 leading-relaxed">
                                  <span className="text-warning flex-shrink-0">−</span><span>{g}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* Verification questions (regular grades, Pro tier only) */}
          {can('verificationQuestions') && a.ai_verification_questions && a.ai_verification_questions.length > 0 && (
            <ReadOnlyVerificationQuestions items={a.ai_verification_questions} />
          )}

          {/* Defense questions (ВКР review) */}
          {r && r.defense_questions.length > 0 && (
            <DefenseQuestionsList
              questions={r.defense_questions}
              chapters={r.chapter_reviews}
            />
          )}

          {/* Submission text — collapsed by default */}
          <section>
            <button
              onClick={() => setShowText((v) => !v)}
              className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider hover:text-ink-secondary transition-colors"
            >
              {showText ? '− Скрыть текст работы' : '+ Показать текст работы'}
            </button>
            {showText && (
              <pre className="mt-2 px-3 py-2.5 bg-surface-warm border border-border rounded-md font-mono text-[12px] leading-[1.7] text-ink whitespace-pre-wrap max-h-72 overflow-y-auto">
                {a.submission_text}
              </pre>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
      {children}
    </div>
  )
}

// Collapsed handout snapshot — shows what the teacher actually composed for
// this assignment (the contract the AI checked the revision against). Useful
// when looking back at a past grade and wanting to remember what was sent.
function HandoutSnapshot({ handout }: { handout: Handout }) {
  const [open, setOpen] = useState(false)
  const addToast = useUIStore((s) => s.addToast)

  function copy(text: string, label: string) {
    navigator.clipboard?.writeText(text).then(
      () => addToast(`${label} скопировано`, 'success'),
      () => addToast('Не удалось скопировать', 'error'),
    )
  }

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider hover:text-ink-secondary transition-colors flex items-center gap-2"
      >
        <span>{open ? '−' : '+'} Доработка для студента</span>
        <span className="text-ink-tertiary normal-case font-normal tracking-normal">
          · {handout.improvements.length} пункт(ов), {handout.questions.length} вопрос(ов)
        </span>
      </button>

      {open && (
        <div className="mt-3 bg-surface-warm border border-border rounded-md p-3 space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wide">Тема</span>
              <button onClick={() => copy(handout.subject, 'Тему')}
                className="text-[11px] text-amber hover:underline">Копировать</button>
            </div>
            <div className="text-[13px] font-sans text-ink leading-snug">{handout.subject}</div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wide">Текст</span>
              <button onClick={() => copy(handout.body, 'Текст')}
                className="text-[11px] text-amber hover:underline">Копировать</button>
            </div>
            <pre className="text-[12.5px] font-sans text-ink leading-relaxed whitespace-pre-wrap">{handout.body}</pre>
          </div>
        </div>
      )}
    </section>
  )
}

// Read-only render of verification questions on the history view — the
// teacher can still see what the AI suggested asking, but no editing or
// citation-jumping (the modal doesn't host a submission pane).
function ReadOnlyVerificationQuestions({ items }: { items: VerificationQuestion[] }) {
  return (
    <section>
      <Label>Спросить студента</Label>
      <div className="bg-info-bg border border-info/15 rounded-lg p-3">
        <ol className="space-y-1.5 list-decimal list-inside">
          {items.map((q, i) => (
            <li key={i} className="text-[13px] font-sans text-ink leading-relaxed">
              {q.question}
              {q.quote && (
                <div className="ml-4 text-[11px] italic text-ink-tertiary border-l-2 border-info/30 pl-1.5 mt-0.5">
                  «{q.quote}»
                </div>
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}

// Read-only mirror of the live grading view's defence questions: same
// chapter-grouping + legacy-shape tolerance, no copy buttons (modal view is
// "look back at a finished review", not "prep for defence today").
function DefenseQuestionsList({
  questions, chapters,
}: { questions: Array<DefenseQuestion | string>; chapters: ChapterReview[] }) {
  const normalised: DefenseQuestion[] = questions.map((q) =>
    typeof q === 'string'
      ? { question: q, chapter_index: null, quote: null, page: null }
      : q
  )
  const general = normalised.filter((q) => q.chapter_index == null)
  const byChapter = new Map<number, DefenseQuestion[]>()
  for (const q of normalised) {
    if (q.chapter_index == null) continue
    if (!byChapter.has(q.chapter_index)) byChapter.set(q.chapter_index, [])
    byChapter.get(q.chapter_index)!.push(q)
  }
  const chapterEntries = Array.from(byChapter.entries()).sort(([a], [b]) => a - b)

  return (
    <section>
      <Label>Вопросы к защите ({normalised.length})</Label>
      <div className="space-y-3">
        {chapterEntries.map(([idx, qs]) => (
          <div key={idx} className="bg-surface-warm border border-border rounded-md p-3">
            <div className="text-[11px] font-sans font-medium text-ink-secondary uppercase tracking-wide mb-2">
              {chapters[idx]?.title ?? `Раздел ${idx + 1}`}
            </div>
            <ol className="space-y-1.5 list-decimal list-inside">
              {qs.map((q, i) => (
                <li key={`${idx}-${i}`} className="text-[13px] font-sans text-ink-secondary leading-relaxed">
                  {q.question}
                  {q.quote && (
                    <div className="ml-4 text-[11px] italic text-ink-tertiary border-l-2 border-border pl-1.5 mt-0.5">
                      «{q.quote}»
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))}
        {general.length > 0 && (
          <div className="bg-surface-warm border border-border rounded-md p-3">
            <div className="text-[11px] font-sans font-medium text-ink-secondary uppercase tracking-wide mb-2">
              Общие
            </div>
            <ol className="space-y-1.5 list-decimal list-inside">
              {general.map((q, i) => (
                <li key={`g-${i}`} className="text-[13px] font-sans text-ink-secondary leading-relaxed">{q.question}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

// Read-only mirror of EditableBulletList in GradingResult — same visual
// language so a bullet in the modal looks identical to a bullet during review,
// just without inputs. Citations render the quote and page; not clickable here
// since the modal doesn't have an attached submission pane to scroll.
function ReadOnlyBulletList({
  title, items, tone,
}: { title: string; items: BulletItem[]; tone: 'success' | 'warning' }) {
  const t = tone === 'success'
    ? { bg: 'bg-success-bg', border: 'border-success/15', text: 'text-success', citeBorder: 'border-success/40' }
    : { bg: 'bg-warning-bg', border: 'border-warning/15', text: 'text-warning', citeBorder: 'border-warning/40' }
  // Hide malformed bullets so old "[object Object]" rows don't show garbage in
  // the history view. Matches GradingResult.coerceBullets.
  const safe = items.filter((b) => {
    const text = typeof b?.text === 'string' ? b.text.trim() : ''
    return text && text !== '[object Object]'
  })
  if (safe.length === 0) return null
  return (
    <div className={`${t.bg} border ${t.border} rounded-lg p-3`}>
      <div className={`text-xs font-semibold ${t.text} uppercase tracking-wide mb-2`}>{title}</div>
      <div className="space-y-1.5">
        {safe.map((b, i) => (
          <div key={i}>
            <div className={`flex gap-1.5 text-xs ${t.text} mb-0.5 leading-relaxed`}>
              <span className="flex-shrink-0">·</span><span>{b.text}</span>
            </div>
            {b.quote && (
              <div className="ml-3 inline-flex items-start gap-1 max-w-full">
                <span className={`text-[10px] mt-0.5 flex-shrink-0 ${t.text} opacity-80`}>↳</span>
                <span className={`text-[11px] italic ${t.text} opacity-90 leading-relaxed border-l-2 ${t.citeBorder} pl-1.5`}>
                  «{b.quote}»
                  {b.page != null && <span className="not-italic font-normal opacity-70"> · стр. {b.page}</span>}
                </span>
              </div>
            )}
            {tone === 'warning' && b.question && (
              <div className="ml-3 mt-0.5 flex items-start gap-1.5">
                <span className={`text-[10px] flex-shrink-0 mt-0.5 ${t.text} opacity-70`}>?</span>
                <span className={`text-[11px] ${t.text} opacity-90 leading-relaxed`}>{b.question}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
