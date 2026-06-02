import { useState } from 'react'
import Button from '../ui/Button'
import FeedbackEmail from './FeedbackEmail'
import { useApprove } from '../../hooks/useGrading'
import type { GradeResponse } from '../../api/grading'
import type { GradeLetter } from '../../types'

interface Props {
  result: GradeResponse
  onApproved: () => void
}

type Tab = 'feedback' | 'criteria' | 'email'

const GRADE_COLORS: Record<GradeLetter, string> = {
  A: 'var(--color-success)',
  B: 'var(--color-amber)',
  C: 'var(--color-warning)',
  D: 'var(--color-danger)',
  F: 'var(--color-danger)',
}

export default function GradingResult({ result, onApproved }: Props) {
  const [tab, setTab] = useState<Tab>('feedback')
  const [editScore, setEditScore]       = useState(String(result.ai_score))
  const [editGrade, setEditGrade]       = useState<GradeLetter>(result.ai_grade)
  const [editFeedback, setEditFeedback] = useState(result.ai_feedback)
  const [approved, setApproved]         = useState(false)
  const approveMut = useApprove()

  const gradeColor = GRADE_COLORS[editGrade] ?? 'var(--color-ink)'

  function handleApprove() {
    approveMut.mutate(
      {
        id: result.assignment_id,
        data: {
          approved_score: Number(editScore),
          approved_grade: editGrade,
          approved_feedback: editFeedback,
        },
      },
      {
        onSuccess: () => {
          setApproved(true)
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

  const GRADES: GradeLetter[] = ['A', 'B', 'C', 'D', 'F']

  return (
    <div className="flex flex-col h-full">
      {/* Score header */}
      <div className="px-5 py-4 border-b border-border flex items-center gap-4">
        <div className="font-display text-5xl font-bold leading-none" style={{ color: gradeColor }}>
          {editGrade}
        </div>
        <div className="flex-1">
          <div className="text-xs font-sans text-ink-secondary mb-1">{result.ai_grade_label}</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              max={100}
              value={editScore}
              onChange={(e) => setEditScore(e.target.value)}
              className="w-16 px-2 py-1 text-sm font-sans text-ink bg-surface border border-border rounded-md text-center"
              disabled={approved}
            />
            <span className="text-sm text-ink-secondary font-sans">/ 100</span>
            <select
              value={editGrade}
              onChange={(e) => setEditGrade(e.target.value as GradeLetter)}
              className="px-2 py-1 text-sm font-sans text-ink bg-surface border border-border rounded-md"
              disabled={approved}
            >
              {GRADES.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
          </div>
        </div>
        {!approved ? (
          <Button onClick={handleApprove} loading={approveMut.isPending}>
            Approve grade
          </Button>
        ) : (
          <span className="text-xs font-sans font-medium bg-success-bg text-success px-3 py-1.5 rounded-md">
            ✓ Approved
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border px-5">
        {(['feedback', 'criteria', 'email'] as Tab[]).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={tabClass(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'feedback' && (
          <div className="space-y-4">
            <div>
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                Overall feedback
              </div>
              <textarea
                value={editFeedback}
                onChange={(e) => setEditFeedback(e.target.value)}
                rows={6}
                disabled={approved}
                className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm border border-border rounded-md leading-relaxed resize-none focus:outline-none focus:border-border-strong disabled:opacity-70"
              />
            </div>

            {(result.ai_strengths?.length > 0 || result.ai_improvements?.length > 0) && (
              <div className="grid grid-cols-2 gap-2.5">
                <div className="bg-success-bg border border-success/15 rounded-lg p-3">
                  <div className="text-xs font-semibold text-success uppercase tracking-wide mb-2">Strengths</div>
                  {result.ai_strengths.map((s) => (
                    <div key={s} className="flex gap-1.5 text-xs text-success mb-1 leading-relaxed">
                      <span className="flex-shrink-0">·</span><span>{s}</span>
                    </div>
                  ))}
                </div>
                <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
                  <div className="text-xs font-semibold text-warning uppercase tracking-wide mb-2">To improve</div>
                  {result.ai_improvements.map((imp) => (
                    <div key={imp} className="flex gap-1.5 text-xs text-warning mb-1 leading-relaxed">
                      <span className="flex-shrink-0">·</span><span>{imp}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'criteria' && (
          <div className="space-y-4">
            {result.ai_criteria_scores.length === 0 ? (
              <p className="text-sm font-sans text-ink-secondary">No rubric was used — holistic grading.</p>
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
