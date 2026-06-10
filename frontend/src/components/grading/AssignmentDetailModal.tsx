import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import Badge from '../ui/Badge'
import RevisionCheckList from './RevisionCheckList'
import { getReviewByAssignment } from '../../api/grading'
import { gradeColor } from '../../lib/grades'
import type { Assignment, GradeLetter, AssignmentStatus } from '../../types'

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
  const [openChapter, setOpenChapter] = useState<number | null>(0)
  const [showText, setShowText]       = useState(false)

  function gradeRevision() {
    onClose()
    navigate(`/grading?revision_of=${a.id}`)
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
            </div>
            <div className="text-xs font-sans text-ink-tertiary">
              {fmt(a.created_at)}
              {a.student_name && <span> · {a.student_name}</span>}
              {a.student_group && <span> · {a.student_group}</span>}
            </div>
          </div>
          <Badge variant={a.status as AssignmentStatus} />
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

          {/* Strengths / improvements — prefer teacher-edited values when present */}
          {(() => {
            const strengths    = a.approved_strengths    ?? a.ai_strengths    ?? []
            const improvements = a.approved_improvements ?? a.ai_improvements ?? []
            if (!strengths.length && !improvements.length) return null
            return (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-success-bg border border-success/15 rounded-lg p-3">
                  <div className="text-xs font-semibold text-success uppercase tracking-wide mb-2">Сильные стороны</div>
                  {strengths.map((s) => (
                    <div key={s} className="flex gap-1.5 text-xs text-success mb-1 leading-relaxed">
                      <span className="flex-shrink-0">·</span><span>{s}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
                  <div className="text-xs font-semibold text-warning uppercase tracking-wide mb-2">Что улучшить</div>
                  {improvements.map((imp) => (
                    <div key={imp} className="flex gap-1.5 text-xs text-warning mb-1 leading-relaxed">
                      <span className="flex-shrink-0">·</span><span>{imp}</span>
                    </div>
                  ))}
                </div>
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

          {/* Defense questions (ВКР review) */}
          {r && r.defense_questions.length > 0 && (
            <section>
              <Label>Вопросы к защите</Label>
              <ol className="space-y-1.5 list-decimal list-inside">
                {r.defense_questions.map((q) => (
                  <li key={q} className="text-[13px] font-sans text-ink-secondary leading-relaxed">{q}</li>
                ))}
              </ol>
            </section>
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
