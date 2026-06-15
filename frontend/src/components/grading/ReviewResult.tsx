import { useState } from 'react'
import Button from '../ui/Button'
import { useApprove } from '../../hooks/useGrading'
import { GRADES, gradeColor, gradeLabel, GRADE_BRACKETS, scoreToGrade, snapScoreToGrade } from '../../lib/grades'
import type { LongReview, GradeLetter, DefenseQuestion, ChapterReview } from '../../types'

interface Props {
  review: LongReview
  onApproved: () => void
}

export default function ReviewResult({ review, onApproved }: Props) {
  const r = review.result!
  const [editScore, setEditScore]       = useState(String(r.suggested_score ?? 75))
  const [editGrade, setEditGrade]       = useState<GradeLetter>(r.suggested_grade ?? '3')
  const [editFeedback, setEditFeedback] = useState(r.overall_summary)
  const [approved, setApproved]         = useState(false)
  const [openChapter, setOpenChapter]   = useState<number | null>(0)
  const approveMut = useApprove()

  const gradeClr = gradeColor(editGrade)

  // Score and letter grade are two views of the same value — keep them aligned.
  // See lib/grades.ts for the bracket logic shared with GradingResult.
  function handleScoreChange(raw: string) {
    setEditScore(raw)
    const n = parseInt(raw, 10)
    if (!Number.isNaN(n) && n >= 0 && n <= 100) {
      const next = scoreToGrade(n)
      if (next !== editGrade) setEditGrade(next)
    }
  }
  function handleGradeChange(next: GradeLetter) {
    setEditGrade(next)
    const current = parseInt(editScore, 10)
    const snapped = snapScoreToGrade(Number.isNaN(current) ? 0 : current, next)
    if (snapped !== current) setEditScore(String(snapped))
  }

  function handleApprove() {
    if (!review.assignment_id) return
    approveMut.mutate(
      { id: review.assignment_id, data: { approved_score: Number(editScore), approved_grade: editGrade, approved_feedback: editFeedback } },
      { onSuccess: () => { setApproved(true); onApproved() } }
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Suggested grade header — explicitly a recommendation */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-4">
        <div className="font-display text-5xl font-bold leading-none" style={{ color: gradeClr }}>
          {editGrade}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm uppercase tracking-wide">
              Рекомендуемая оценка
            </span>
            <span className="text-xs font-sans text-ink-secondary">
              {gradeLabel(editGrade)}
              <span className="text-ink-tertiary"> · {GRADE_BRACKETS[editGrade][0]}–{GRADE_BRACKETS[editGrade][1]}</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number" min={0} max={100} value={editScore}
              onChange={(e) => handleScoreChange(e.target.value)} disabled={approved}
              className="w-16 px-2 py-1 text-sm font-sans text-ink bg-surface border border-border rounded-md text-center"
            />
            <span className="text-sm text-ink-secondary font-sans">/ 100</span>
            <select
              value={editGrade} onChange={(e) => handleGradeChange(e.target.value as GradeLetter)} disabled={approved}
              className="px-2 py-1 text-sm font-sans text-ink bg-surface border border-border rounded-md"
            >
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        {!approved ? (
          <Button onClick={handleApprove} loading={approveMut.isPending} disabled={!review.assignment_id}>
            Подтвердить оценку
          </Button>
        ) : (
          <span className="text-xs font-sans font-medium bg-success-bg text-success px-3 py-1.5 rounded-md">
            ✓ Подтверждено
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* Overall summary */}
        <section>
          <SectionLabel>Общее заключение</SectionLabel>
          <textarea
            value={editFeedback} onChange={(e) => setEditFeedback(e.target.value)} rows={6} disabled={approved}
            className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm border border-border rounded-md leading-relaxed resize-none focus:outline-none focus:border-border-strong disabled:opacity-70"
          />
        </section>

        {/* Overall strengths / gaps */}
        {(r.overall_strengths.length > 0 || r.overall_gaps.length > 0) && (
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-success-bg border border-success/15 rounded-lg p-3">
              <div className="text-xs font-semibold text-success uppercase tracking-wide mb-2">Сильные стороны</div>
              {r.overall_strengths.map((s) => (
                <div key={s} className="flex gap-1.5 text-xs text-success mb-1 leading-relaxed">
                  <span className="flex-shrink-0">·</span><span>{s}</span>
                </div>
              ))}
            </div>
            <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
              <div className="text-xs font-semibold text-warning uppercase tracking-wide mb-2">Недостатки</div>
              {r.overall_gaps.map((g) => (
                <div key={g} className="flex gap-1.5 text-xs text-warning mb-1 leading-relaxed">
                  <span className="flex-shrink-0">·</span><span>{g}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Chapter-by-chapter — the heart of the review */}
        {r.chapter_reviews.length > 0 && (
          <section>
            <SectionLabel>Разбор по разделам ({r.chapter_reviews.length})</SectionLabel>
            <div className="space-y-2">
              {r.chapter_reviews.map((c, i) => {
                const open = openChapter === i
                return (
                  <div key={i} className="border border-border rounded-lg overflow-hidden bg-surface">
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

        {/* Defense questions — grouped by chapter when chapter_index is set */}
        {r.defense_questions.length > 0 && (
          <DefenseQuestionsBlock
            questions={r.defense_questions}
            chapters={r.chapter_reviews}
          />
        )}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
      {children}
    </div>
  )
}

// ─── Defence questions block ─────────────────────────────────────────────────
// Tolerant of two shapes: the new {question, chapter_index, quote, page} and
// the legacy plain-string list still present on older rows. Groups by chapter
// so the teacher can prep questions section-by-section, with copy buttons.

function DefenseQuestionsBlock({
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
  // Stable chapter order (ascending), then general at the end.
  const chapterEntries = Array.from(byChapter.entries()).sort(([a], [b]) => a - b)

  return (
    <section>
      <SectionLabel>Вопросы к защите ({normalised.length})</SectionLabel>
      <div className="space-y-3">
        {chapterEntries.map(([idx, qs]) => (
          <div key={idx} className="bg-surface-warm border border-border rounded-md p-3">
            <div className="text-[11px] font-sans font-medium text-ink-secondary uppercase tracking-wide mb-2">
              {chapters[idx]?.title ?? `Раздел ${idx + 1}`}
            </div>
            <ol className="space-y-2 list-decimal list-inside">
              {qs.map((q, i) => (
                <DefenseQuestionItem key={`${idx}-${i}`} q={q} />
              ))}
            </ol>
          </div>
        ))}
        {general.length > 0 && (
          <div className="bg-surface-warm border border-border rounded-md p-3">
            <div className="text-[11px] font-sans font-medium text-ink-secondary uppercase tracking-wide mb-2">
              Общие
            </div>
            <ol className="space-y-2 list-decimal list-inside">
              {general.map((q, i) => <DefenseQuestionItem key={`g-${i}`} q={q} />)}
            </ol>
          </div>
        )}
      </div>
    </section>
  )
}

function DefenseQuestionItem({ q }: { q: DefenseQuestion }) {
  return (
    <li className="text-[13px] font-sans text-ink-secondary leading-relaxed">
      <span>{q.question}</span>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(q.question)}
        className="ml-2 text-[10px] text-ink-tertiary hover:text-amber transition-colors"
        title="Скопировать"
      >
        копировать
      </button>
      {q.quote && (
        <div className="ml-4 mt-0.5 inline-flex items-start gap-1">
          <span className="text-[10px] text-ink-tertiary mt-0.5">↳</span>
          <span className="text-[11px] italic text-ink-tertiary leading-relaxed border-l-2 border-border pl-1.5">
            «{q.quote}»
          </span>
        </div>
      )}
    </li>
  )
}
