import { useState } from 'react'
import Button from '../ui/Button'
import FeedbackEmail from './FeedbackEmail'
import RevisionCheckList from './RevisionCheckList'
import ConfidenceBadge from './ConfidenceBadge'
import { useApprove } from '../../hooks/useGrading'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'
import { usePersistedState, clearPersistedState } from '../../hooks/usePersistedState'
import { GRADES, gradeColor, gradeLabel, GRADE_BRACKETS, scoreToGrade, snapScoreToGrade } from '../../lib/grades'
import type { GradeResponse } from '../../api/grading'
import type { GradeLetter } from '../../types'

interface Props {
  result: GradeResponse
  onApproved: () => void
  // When the teacher clicks a citation in the per-criterion feedback, the
  // host page highlights and scrolls to the quote in the submission pane.
  onCite?: (quote: string) => void
}

type Tab = 'feedback' | 'criteria' | 'email'

export default function GradingResult({ result, onApproved, onCite }: Props) {
  const [tab, setTab] = useState<Tab>('feedback')
  const { can } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const emailEnabled = can('emailGeneration')
  // Teacher edits persist per-assignment across page refresh so an accidental
  // reload doesn't drop a hand-edited score, grade, or feedback bullet.
  // Cleared on approve (below) and on the "Новая проверка" reset in Grading.tsx.
  const editKey = `edits:${result.assignment_id}`
  const [editScore, setEditScore]       = usePersistedState<string>(`${editKey}:score`,    String(result.ai_score))
  const [editGrade, setEditGrade]       = usePersistedState<GradeLetter>(`${editKey}:grade`, result.ai_grade)

  // Keep score and letter grade in sync — they're two views of the same value.
  // Score → grade: deterministic bracket lookup.
  // Grade → score: only nudge the score when it falls outside the new bracket,
  // so a teacher's "4 → 5" bump preserves a score of 85 by moving it to 87
  // rather than jumping to the middle of the 5-bracket.
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
  const [editFeedback, setEditFeedback] = usePersistedState<string>(`${editKey}:feedback`,        result.ai_feedback)
  const [editStrengths, setEditStrengths]       = usePersistedState<string[]>(`${editKey}:strengths`,    result.ai_strengths    ?? [])
  const [editImprovements, setEditImprovements] = usePersistedState<string[]>(`${editKey}:improvements`, result.ai_improvements ?? [])
  const [approved, setApproved]         = useState(false)
  const approveMut = useApprove()

  const gradeClr = gradeColor(editGrade)

  function handleApprove() {
    approveMut.mutate(
      {
        id: result.assignment_id,
        data: {
          approved_score: Number(editScore),
          approved_grade: editGrade,
          approved_feedback: editFeedback,
          // Only send these if they differ from the AI defaults — keeps the DB
          // honest about what the teacher actually edited.
          ...(arraysEqual(editStrengths,    result.ai_strengths    ?? []) ? {} : { approved_strengths:    editStrengths.filter((s) => s.trim()) }),
          ...(arraysEqual(editImprovements, result.ai_improvements ?? []) ? {} : { approved_improvements: editImprovements.filter((s) => s.trim()) }),
        },
      },
      {
        onSuccess: () => {
          setApproved(true)
          // Once the grade is committed server-side, the local draft is junk.
          clearPersistedState(`${editKey}:score`)
          clearPersistedState(`${editKey}:grade`)
          clearPersistedState(`${editKey}:feedback`)
          clearPersistedState(`${editKey}:strengths`)
          clearPersistedState(`${editKey}:improvements`)
          onApproved()
        },
      }
    )
  }

  const tabClass = (t: Tab) =>
    `px-3 py-2 text-xs font-sans font-medium border-b-2 transition-colors cursor-pointer ${
      tab === t
        ? 'border-amber text-amber'
        : 'border-transparent text-ink-secondary hover:text-ink'
    }`

  return (
    <div className="flex flex-col h-full">
      {/* Score header */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-4">
        <div className="font-display text-5xl font-bold leading-none" style={{ color: gradeClr }}>
          {editGrade}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-sans text-ink-secondary">
              {gradeLabel(editGrade)}
              <span className="text-ink-tertiary"> · {GRADE_BRACKETS[editGrade][0]}–{GRADE_BRACKETS[editGrade][1]}</span>
            </span>
            {result.revision_number > 1 && (
              <span
                className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm"
                title="Эта работа — переработка предыдущей версии"
              >
                ↻ Переработка №{result.revision_number}
              </span>
            )}
            {result.used_examples > 0 && (
              <span
                className="text-[10px] font-sans font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm"
                title={`Оценка основана на ${result.used_examples} похожих работах из архива предмета`}
              >
                ✦ RAG ×{result.used_examples}
              </span>
            )}
            {result.ai_confidence && (
              <ConfidenceBadge level={result.ai_confidence} ensemble={result.ai_ensemble} size="sm" />
            )}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={editScore}
              onChange={(e) => handleScoreChange(e.target.value)}
              className="w-16 px-2 py-1 text-sm font-sans text-ink bg-surface border border-border rounded-md text-center"
              disabled={approved}
            />
            <span className="text-sm text-ink-secondary font-sans">/ 100</span>
            <select
              value={editGrade}
              onChange={(e) => handleGradeChange(e.target.value as GradeLetter)}
              className="px-2 py-1 text-sm font-sans text-ink bg-surface border border-border rounded-md"
              disabled={approved}
            >
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        {!approved ? (
          <Button onClick={handleApprove} loading={approveMut.isPending}>
            Подтвердить оценку
          </Button>
        ) : (
          <span className="text-xs font-sans font-medium bg-success-bg text-success px-3 py-1.5 rounded-md">
            ✓ Подтверждено
          </span>
        )}
      </div>

      {/* Low-confidence triage banner — the variants disagreed; ask for a look */}
      {result.ai_confidence === 'low' && !approved && (
        <div className="mx-5 mt-3 px-3 py-2.5 bg-warning-bg border border-warning/20 rounded-md flex items-start gap-2.5">
          <span className="text-warning text-sm mt-0.5 flex-shrink-0">⚠</span>
          <div className="text-[12.5px] font-sans text-ink leading-relaxed">
            <span className="font-medium">ИИ не уверен в этой оценке.</span>{' '}
            <span className="text-ink-secondary">
              Варианты модели дали разные результаты
              {result.ai_ensemble && ` (${result.ai_ensemble.samples.map((s) => s.grade).join(', ')})`}
              {' '}— стоит проверить работу внимательнее перед подтверждением.
            </span>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border px-5">
        {([['feedback', 'Отзыв'], ['criteria', 'Критерии']] as [Tab, string][]).map(([t, label]) => (
          <button key={t} onClick={() => setTab(t)} className={tabClass(t)}>
            {label}
          </button>
        ))}
        {/* Email tab — locked on free tier */}
        {emailEnabled ? (
          <button onClick={() => setTab('email')} className={tabClass('email')}>
            Письмо
          </button>
        ) : (
          <div className="relative ml-1">
            <button
              onClick={() => showUpgradeModal('FEATURE_NOT_IN_PLAN')}
              className="px-3 py-2.5 text-xs font-sans text-ink-tertiary opacity-60 cursor-pointer"
            >
              Письмо
            </button>
            <span className="absolute -top-0.5 -right-1 text-[9px] bg-amber-light text-amber px-1 py-px rounded-sm font-sans font-semibold leading-none">
              Pro
            </span>
          </div>
        )}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'feedback' && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                Общий отзыв
              </div>
              <textarea
                value={editFeedback}
                onChange={(e) => setEditFeedback(e.target.value)}
                rows={6}
                disabled={approved}
                className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm border border-border rounded-md leading-relaxed resize-none focus:outline-none focus:border-border-strong disabled:opacity-70"
              />
            </div>

            {result.ai_revision_check && result.ai_revision_check.length > 0 && (
              <RevisionCheckList items={result.ai_revision_check} />
            )}

            {(editStrengths.length > 0 || editImprovements.length > 0 || !approved) && (
              <div className="grid grid-cols-2 gap-2.5">
                <EditableBulletList
                  title="Сильные стороны"
                  items={editStrengths}
                  onChange={setEditStrengths}
                  disabled={approved}
                  tone="success"
                />
                <EditableBulletList
                  title="Что улучшить"
                  items={editImprovements}
                  onChange={setEditImprovements}
                  disabled={approved}
                  tone="warning"
                />
              </div>
            )}
          </div>
        )}

        {tab === 'criteria' && (
          <div className="space-y-4">
            {result.ai_criteria_scores.length === 0 ? (
              <p className="text-sm font-sans text-ink-secondary">Критерии не использовались — общая оценка.</p>
            ) : (
              result.ai_criteria_scores.map((cs) => (
                <div key={cs.name}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-sans font-medium text-ink">{cs.name}</span>
                    <span className="text-sm font-sans text-ink-secondary">{cs.score}/100</span>
                  </div>
                  <div className="h-1 bg-border rounded-full overflow-hidden mb-2">
                    <div
                      className="h-full rounded-full transition-all duration-700 ease-out"
                      style={{ width: `${cs.score}%`, backgroundColor: scoreColor(cs.score) }}
                    />
                  </div>
                  <p className="text-xs font-sans text-ink-secondary leading-relaxed">{cs.feedback}</p>
                  {cs.quote && (
                    <button
                      type="button"
                      onClick={() => onCite?.(cs.quote!)}
                      title="Показать в работе"
                      className="mt-1.5 group inline-flex items-start gap-1.5 text-left max-w-full"
                    >
                      <span className="text-[10px] font-sans font-medium text-amber mt-0.5 flex-shrink-0">↳</span>
                      <span className="text-xs font-sans italic text-ink-secondary leading-relaxed border-l-2 border-amber/40 group-hover:border-amber pl-2 transition-colors">
                        «{cs.quote}»
                        {cs.page != null && (
                          <span className="not-italic text-ink-tertiary font-normal"> · стр. {cs.page}</span>
                        )}
                      </span>
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        )}

        {tab === 'email' && (
          <FeedbackEmail assignmentId={result.assignment_id} />
        )}
      </div>
    </div>
  )
}

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--color-success)'
  if (score >= 55) return 'var(--color-amber)'
  return 'var(--color-danger)'
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}

// ─── Editable bullet list ─────────────────────────────────────────────────────
// Used for the strengths + improvements blocks. Teacher can edit text inline,
// remove a bullet, or add a new one — until the grade is approved, at which
// point the list locks. The improvements list is what feeds the revision check
// when the student resubmits — so editing here directly improves the next grade.

const TONES: Record<'success' | 'warning', { bg: string; border: string; text: string; titleText: string }> = {
  success: { bg: 'bg-success-bg', border: 'border-success/15', text: 'text-success', titleText: 'text-success' },
  warning: { bg: 'bg-warning-bg', border: 'border-warning/15', text: 'text-warning', titleText: 'text-warning' },
}

function EditableBulletList({ title, items, onChange, disabled, tone }: {
  title: string
  items: string[]
  onChange: (next: string[]) => void
  disabled: boolean
  tone: 'success' | 'warning'
}) {
  const t = TONES[tone]
  function setAt(i: number, value: string) { onChange(items.map((v, idx) => idx === i ? value : v)) }
  function removeAt(i: number) { onChange(items.filter((_, idx) => idx !== i)) }
  function add() { onChange([...items, '']) }

  return (
    <div className={`${t.bg} border ${t.border} rounded-lg p-3`}>
      <div className={`text-xs font-semibold ${t.titleText} uppercase tracking-wide mb-2`}>{title}</div>
      <div className="space-y-1">
        {items.map((value, i) => (
          <div key={i} className={`flex gap-1.5 text-xs ${t.text} leading-relaxed items-start group`}>
            <span className="flex-shrink-0 mt-1">·</span>
            <textarea
              value={value}
              onChange={(e) => setAt(i, e.target.value)}
              disabled={disabled}
              rows={1}
              className={`flex-1 bg-transparent ${t.text} text-xs leading-relaxed resize-none focus:outline-none focus:bg-surface/40 rounded px-1 py-0.5 disabled:opacity-90`}
              style={{ minHeight: '1.4em' }}
            />
            {!disabled && (
              <button
                type="button"
                onClick={() => removeAt(i)}
                className={`flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity ${t.text} hover:opacity-100 text-sm leading-none mt-0.5`}
                aria-label="Удалить пункт"
                title="Удалить пункт"
              >
                ×
              </button>
            )}
          </div>
        ))}
      </div>
      {!disabled && (
        <button
          type="button"
          onClick={add}
          className={`mt-1.5 text-[11px] font-sans ${t.text} hover:underline`}
        >
          + Добавить
        </button>
      )}
    </div>
  )
}
