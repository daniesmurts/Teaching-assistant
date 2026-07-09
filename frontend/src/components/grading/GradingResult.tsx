import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import FeedbackEmail from './FeedbackEmail'
import RevisionCheckList from './RevisionCheckList'
import QuestionResponseList from './QuestionResponseList'
import ConfidenceBadge from './ConfidenceBadge'
import HandoutModal from './HandoutModal'
import StudentTrajectory from './StudentTrajectory'
import { useApprove } from '../../hooks/useGrading'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'
import { usePersistedState, clearPersistedState } from '../../hooks/usePersistedState'
import { GRADES, gradeColor, gradeLabel, GRADE_BRACKETS, scoreToGrade, snapScoreToGrade } from '../../lib/grades'
import { getStudentTrajectory } from '../../api/grading'
import type { GradeResponse } from '../../api/grading'
import type { GradeLetter, BulletItem, BulletSeverity, VerificationQuestion, CriterionScore, ApprovedEditReason } from '../../types'

interface Props {
  result: GradeResponse
  onApproved: () => void
  // When the teacher clicks a citation in the per-criterion feedback, the
  // host page highlights and scrolls to the quote in the submission pane.
  onCite?: (quote: string) => void
  // Identity of the student just graded, if known — powers the "За семестр"
  // tab. Absent (no student_name on the submission) hides the tab entirely.
  student?: { name?: string; group?: string; courseId?: string }
}

type Tab = 'feedback' | 'criteria' | 'email' | 'trajectory'

export default function GradingResult({ result, onApproved, onCite, student }: Props) {
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
  // Coerce on the initial value too, not just from persisted-state: this also
  // sanitises bullets that arrived from the backend with "[object Object]" text
  // (a known prod casualty from a brief normaliseBullets gap).
  const [editStrengths, setEditStrengths]       = usePersistedState<BulletItem[]>(`${editKey}:strengths`,    coerceBullets(result.ai_strengths    ?? []))
  const [editImprovements, setEditImprovements] = usePersistedState<BulletItem[]>(`${editKey}:improvements`, coerceBullets(result.ai_improvements ?? []))
  // Belt-and-braces: drafts persisted before the BulletItem migration were
  // string[]; one-shot coerce so old reloads don't crash on b.text.
  useEffect(() => {
    const sNeedsFix = editStrengths.some((b) => typeof (b as unknown) === 'string' || typeof b?.text !== 'string')
    if (sNeedsFix) setEditStrengths(coerceBullets(editStrengths))
    const iNeedsFix = editImprovements.some((b) => typeof (b as unknown) === 'string' || typeof b?.text !== 'string')
    if (iNeedsFix) setEditImprovements(coerceBullets(editImprovements))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [approved, setApproved]         = useState(false)
  const [handoutOpen, setHandoutOpen]   = useState(false)
  const approveMut = useApprove()

  // Trajectory (Feature B) — last few grades for this student, fetched only
  // when the teacher supplied a name. No new AI calls: pure history lookup.
  const trajectoryEnabled = Boolean(student?.name)
  const { data: trajectory, isLoading: trajectoryLoading } = useQuery({
    queryKey: ['student-trajectory', student?.name, student?.group, student?.courseId, result.assignment_id],
    queryFn: () => getStudentTrajectory({
      student_name:  student!.name!,
      student_group: student?.group,
      course_id:     student?.courseId,
      exclude_id:    result.assignment_id,
    }),
    enabled: trajectoryEnabled,
  })

  // Per-criterion approved scores. Start with the AI's scores; teacher can edit
  // individual entries from the Критерии tab. Persisted under the same draft
  // key family so a tab refresh doesn't lose edits.
  const [editCriteriaScores, setEditCriteriaScores] = usePersistedState<CriterionScore[]>(
    `${editKey}:criteria_scores`,
    result.ai_criteria_scores ?? [],
  )
  const [editReason, setEditReason] = usePersistedState<ApprovedEditReason | ''>(
    `${editKey}:edit_reason`,
    '',
  )

  const gradeClr = gradeColor(editGrade)

  function handleApprove() {
    // Only send fields the teacher actually edited — keeps the DB honest about
    // what was an AI default vs an explicit teacher decision.
    const criteriaScoresEdited = !criteriaScoresEqual(editCriteriaScores, result.ai_criteria_scores ?? [])

    approveMut.mutate(
      {
        id: result.assignment_id,
        data: {
          approved_score: Number(editScore),
          approved_grade: editGrade,
          approved_feedback: editFeedback,
          ...(bulletsEqual(editStrengths,    result.ai_strengths    ?? []) ? {} : { approved_strengths:    editStrengths.filter((b) => b.text.trim()) }),
          ...(bulletsEqual(editImprovements, result.ai_improvements ?? []) ? {} : { approved_improvements: editImprovements.filter((b) => b.text.trim()) }),
          ...(criteriaScoresEdited ? { approved_criteria_scores: editCriteriaScores } : {}),
          ...(editReason ? { approved_edit_reason: editReason as ApprovedEditReason } : {}),
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
          clearPersistedState(`${editKey}:criteria_scores`)
          clearPersistedState(`${editKey}:edit_reason`)
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
          <div className="flex items-center gap-2">
            <EditReasonPicker value={editReason} onChange={setEditReason} disabled={approveMut.isPending} />
            <Button onClick={handleApprove} loading={approveMut.isPending}>
              Подтвердить оценку
            </Button>
          </div>
        ) : (
          <span className="text-xs font-sans font-medium bg-success-bg text-success px-3 py-1.5 rounded-md">
            ✓ Подтверждено
          </span>
        )}
      </div>

      {/* Confidence row — pulled out of the chip cluster so the teacher actually
          sees it. Low has its own warning banner below. Container tint matches
          the badge level so the row reads at a glance. */}
      {result.ai_confidence && result.ai_confidence !== 'low' && (
        <div
          className={`mx-5 mt-3 px-3 py-2 border rounded-md flex items-center gap-2.5 ${
            result.ai_confidence === 'high'
              ? 'bg-success-bg border-success/20'
              : 'bg-amber-light border-amber/25'
          }`}
        >
          <ConfidenceBadge level={result.ai_confidence} ensemble={result.ai_ensemble} size="md" />
          <span className="text-[12.5px] font-sans text-ink-secondary leading-relaxed">
            {result.ai_confidence === 'high'
              ? 'Варианты модели сошлись на одной оценке — ИИ уверен в результате.'
              : 'Между вариантами модели есть небольшой разброс. Просмотрите ключевые моменты перед подтверждением.'}
          </span>
        </div>
      )}

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
        {trajectoryEnabled && (
          <button onClick={() => setTab('trajectory')} className={tabClass('trajectory')}>
            За семестр
          </button>
        )}
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
              <AutoGrowTextarea
                value={editFeedback}
                onChange={(e) => setEditFeedback(e.target.value)}
                disabled={approved}
                minRows={6}
                className="w-full px-3 py-2 text-sm font-sans text-ink bg-surface-warm border border-border rounded-md leading-relaxed focus:outline-none focus:border-border-strong disabled:opacity-70"
              />
            </div>

            {result.ai_revision_check && result.ai_revision_check.length > 0 && (
              <RevisionCheckList items={result.ai_revision_check} />
            )}

            {result.ai_question_responses && result.ai_question_responses.length > 0 && (
              <QuestionResponseList items={result.ai_question_responses} />
            )}

            {(editStrengths.length > 0 || editImprovements.length > 0 || !approved) && (
              <div className="grid grid-cols-2 gap-2.5">
                <EditableBulletList
                  title="Сильные стороны"
                  items={editStrengths}
                  onChange={setEditStrengths}
                  disabled={approved}
                  tone="success"
                  onCite={onCite}
                  criteria={result.criteria_snapshot ?? []}
                />
                <EditableBulletList
                  title="Что улучшить"
                  items={editImprovements}
                  onChange={setEditImprovements}
                  disabled={approved}
                  tone="warning"
                  onCite={onCite}
                  criteria={result.criteria_snapshot ?? []}
                />
              </div>
            )}

            {/* Verification questions — Pro tier only. The framing is
                deliberately "ask the student to verify they understand their
                own work", not "did they use AI". */}
            {can('verificationQuestions') && result.ai_verification_questions.length > 0 && (
              <VerificationQuestionsPanel
                items={result.ai_verification_questions}
                onCite={onCite}
              />
            )}

            {/* "Доработка" trigger — packages the selected improvements + the
                AI's questions into a handout the teacher can paste to the
                student. Pro-tier and only shows when there's something to
                send (the modal would be empty otherwise). */}
            {can('handout')
              && (editImprovements.length > 0 || result.ai_verification_questions.length > 0) && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setHandoutOpen(true)}
                  className="text-xs font-sans font-medium text-amber hover:underline"
                >
                  ✦ Собрать доработку для студента
                </button>
              </div>
            )}
          </div>
        )}

        {handoutOpen && (
          <HandoutModal
            assignmentId={result.assignment_id}
            improvements={editImprovements}
            verificationQuestions={result.ai_verification_questions}
            onClose={() => setHandoutOpen(false)}
          />
        )}

        {tab === 'criteria' && (
          <div className="space-y-4">
            {editCriteriaScores.length === 0 ? (
              <p className="text-sm font-sans text-ink-secondary">Критерии не использовались — общая оценка.</p>
            ) : (
              editCriteriaScores.map((cs, idx) => {
                const aiCs = result.ai_criteria_scores[idx]
                const edited = aiCs && aiCs.score !== cs.score
                return (
                  <div key={`${cs.name}-${idx}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-sans font-medium text-ink">{cs.name}</span>
                      <div className="flex items-center gap-2">
                        {edited && aiCs && (
                          <span className="text-[10px] font-sans text-ink-tertiary">
                            ИИ: {aiCs.score}
                          </span>
                        )}
                        <input
                          type="number" min={0} max={100} value={cs.score}
                          disabled={approved}
                          onChange={(e) => {
                            const next = Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0))
                            setEditCriteriaScores((prev) =>
                              prev.map((p, i) => i === idx ? { ...p, score: next } : p)
                            )
                          }}
                          className="w-14 px-1.5 py-0.5 text-sm font-sans text-ink bg-surface border border-border rounded-md text-center disabled:opacity-70"
                        />
                        <span className="text-xs font-sans text-ink-tertiary">/ 100</span>
                      </div>
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
                )
              })
            )}
          </div>
        )}

        {tab === 'email' && (
          <FeedbackEmail assignmentId={result.assignment_id} />
        )}

        {tab === 'trajectory' && (
          <StudentTrajectory
            loading={trajectoryLoading}
            entries={trajectory ?? []}
            currentScore={parseInt(editScore, 10)}
            currentGrade={editGrade}
            currentCriteriaScores={editCriteriaScores}
          />
        )}
      </div>
    </div>
  )
}

// Dropdown that captures WHY the teacher's about to override the AI draft.
// Optional — null/empty means "no reason given". Surfaces six categories so
// the corpus has a queryable taxonomy of judgment-calls (item #2 of the
// asset-hardening pass).
function EditReasonPicker({
  value, onChange, disabled,
}: {
  value:    ApprovedEditReason | ''
  onChange: (v: ApprovedEditReason | '') => void
  disabled: boolean
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as ApprovedEditReason | '')}
      disabled={disabled}
      title="Опционально: почему вы правите оценку ИИ?"
      className="px-2 py-1 text-xs font-sans text-ink bg-surface border border-border rounded-md hover:border-border-strong"
    >
      <option value="">Причина правки…</option>
      <option value="fact_check">фактическая ошибка</option>
      <option value="tone">тон / формулировка</option>
      <option value="criterion_weight">веса критериев</option>
      <option value="scale">шкала оценивания</option>
      <option value="scope">ИИ отклонился от задания</option>
      <option value="other">другое</option>
    </select>
  )
}

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--color-success)'
  if (score >= 55) return 'var(--color-amber)'
  return 'var(--color-danger)'
}

function bulletsEqual(a: BulletItem[], b: BulletItem[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) =>
    v.text === b[i].text
    && (v.quote ?? null)         === (b[i].quote ?? null)
    && (v.page ?? null)          === (b[i].page  ?? null)
    && (v.criterion_id ?? null)  === (b[i].criterion_id ?? null)
  )
}

function criteriaScoresEqual(a: CriterionScore[], b: CriterionScore[]): boolean {
  if (a.length !== b.length) return false
  return a.every((v, i) =>
    v.name === b[i].name
    && v.score === b[i].score
    && (v.feedback ?? '') === (b[i].feedback ?? '')
  )
}

// Migrate legacy string[] persisted drafts to the new BulletItem[] shape, and
// quietly drop anything malformed — including rows from a brief window where
// the model returned nested objects and the old normaliser stringified them
// as "[object Object]". Those rows still exist in the DB; this hides them so
// the UI doesn't display garbage. The teacher can still re-grade to get
// well-formed bullets.
function coerceBullets(raw: BulletItem[]): BulletItem[] {
  return (raw as unknown as Array<string | BulletItem | unknown>)
    .map((b): BulletItem | null => {
      if (typeof b === 'string') {
        const trimmed = b.trim()
        return trimmed && trimmed !== '[object Object]'
          ? { text: trimmed, quote: null, page: null }
          : null
      }
      if (b && typeof b === 'object' && 'text' in (b as Record<string, unknown>)) {
        const item = b as BulletItem
        const text = typeof item.text === 'string' ? item.text.trim() : ''
        if (!text || text === '[object Object]') return null
        return { ...item, text }
      }
      return null
    })
    .filter((b): b is BulletItem => b !== null)
}

// ─── Editable bullet list ─────────────────────────────────────────────────────
// Used for the strengths + improvements blocks. Teacher can edit text inline,
// remove a bullet, or add a new one — until the grade is approved, at which
// point the list locks. The improvements list is what feeds the revision check
// when the student resubmits — so editing here directly improves the next grade.

const TONES: Record<'success' | 'warning', { bg: string; border: string; text: string; titleText: string; citeBorder: string }> = {
  success: { bg: 'bg-success-bg', border: 'border-success/15', text: 'text-success', titleText: 'text-success', citeBorder: 'border-success/40' },
  warning: { bg: 'bg-warning-bg', border: 'border-warning/15', text: 'text-warning', titleText: 'text-warning', citeBorder: 'border-warning/40' },
}

// Severity dot + label — same visual language as LongReviewBullet.tsx
// (ВКР long-review findings). Only improvement bullets ever carry a
// severity (e.g. calc-verification mismatches), so this only renders on
// the 'warning' tone.
const SEVERITY_DOT_CLASS: Record<BulletSeverity, string> = {
  critical:    'bg-danger',
  substantial: 'bg-warning',
  minor:       'bg-ink-tertiary',
}
const SEVERITY_LABEL: Record<BulletSeverity, string> = {
  critical:    'критично',
  substantial: 'существенно',
  minor:       'незначительно',
}

function EditableBulletList({ title, items, onChange, disabled, tone, onCite, criteria = [] }: {
  title: string
  items: BulletItem[]
  onChange: (next: BulletItem[]) => void
  disabled: boolean
  tone: 'success' | 'warning'
  onCite?: (quote: string) => void
  /** When present, each bullet gets a "к критерию: …" dropdown. */
  criteria?: Array<{ criterion_id: string | null; name: string }>
}) {
  const t = TONES[tone]
  const criteriaWithId = criteria.filter((c) => !!c.criterion_id)
  const nameById = new Map(criteriaWithId.map((c) => [c.criterion_id!, c.name]))

  function setTextAt(i: number, text: string) {
    onChange(items.map((b, idx) => idx === i ? { ...b, text } : b))
  }
  function setCriterionAt(i: number, id: string | null) {
    onChange(items.map((b, idx) => idx === i ? { ...b, criterion_id: id } : b))
  }
  function removeAt(i: number) { onChange(items.filter((_, idx) => idx !== i)) }
  function add() { onChange([...items, { text: '', quote: null, page: null }]) }

  return (
    <div className={`${t.bg} border ${t.border} rounded-lg p-3`}>
      <div className={`text-xs font-semibold ${t.titleText} uppercase tracking-wide mb-2`}>{title}</div>
      <div className="space-y-1.5">
        {items.map((b, i) => (
          <div key={i}>
            <div className={`flex gap-1.5 text-xs ${t.text} leading-relaxed items-start group`}>
              {tone === 'warning' && b.severity && (
                <span
                  className={`${SEVERITY_DOT_CLASS[b.severity]} w-2 h-2 rounded-full mt-1.5 flex-shrink-0`}
                  title={SEVERITY_LABEL[b.severity]}
                  aria-label={`severity: ${SEVERITY_LABEL[b.severity]}`}
                />
              )}
              <span className="flex-shrink-0 mt-1">·</span>
              <AutoGrowTextarea
                value={b.text}
                onChange={(e) => setTextAt(i, e.target.value)}
                disabled={disabled}
                className={`flex-1 bg-transparent ${t.text} text-xs leading-relaxed focus:outline-none focus:bg-surface/40 rounded px-1 py-0.5 disabled:opacity-90`}
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
            {b.quote && (
              <button
                type="button"
                onClick={() => onCite?.(b.quote!)}
                title="Показать в работе"
                className="ml-3 mt-0.5 inline-flex items-start gap-1 text-left max-w-full group/cite"
              >
                <span className={`text-[10px] mt-0.5 flex-shrink-0 ${t.text} opacity-80`}>↳</span>
                <span className={`text-[11px] italic ${t.text} opacity-90 leading-relaxed border-l-2 ${t.citeBorder} group-hover/cite:opacity-100 pl-1.5 transition-opacity`}>
                  «{b.quote}»
                  {b.page != null && <span className="not-italic font-normal opacity-70"> · стр. {b.page}</span>}
                </span>
              </button>
            )}
            {/* Criterion link — small dropdown so the teacher can attach
                each bullet to the criterion it relates to. Only shown when
                this grade actually has criteria. */}
            {criteriaWithId.length > 0 && (
              <div className="ml-3 mt-0.5 flex items-center gap-1">
                <span className={`text-[10px] ${t.text} opacity-60`}>к критерию:</span>
                {disabled ? (
                  <span className={`text-[10px] ${t.text} opacity-80`}>
                    {b.criterion_id ? nameById.get(b.criterion_id) ?? '—' : '—'}
                  </span>
                ) : (
                  <select
                    value={b.criterion_id ?? ''}
                    onChange={(e) => setCriterionAt(i, e.target.value || null)}
                    className={`text-[10px] bg-transparent ${t.text} border-0 border-b border-dotted ${t.citeBorder} focus:outline-none cursor-pointer`}
                  >
                    <option value="">—</option>
                    {criteriaWithId.map((c) => (
                      <option key={c.criterion_id!} value={c.criterion_id!}>{c.name}</option>
                    ))}
                  </select>
                )}
              </div>
            )}
            {/* "Спросить об этом" — only on improvement bullets where the AI
                produced a follow-up question. Pro-tier feature gate is on the
                parent; here we just render if present. */}
            {tone === 'warning' && b.question && (
              <div className="ml-3 mt-1 flex items-start gap-1.5">
                <span className={`text-[10px] flex-shrink-0 mt-0.5 ${t.text} opacity-70`}>?</span>
                <span className={`text-[11px] ${t.text} opacity-90 leading-relaxed flex-1`}>
                  {b.question}
                </span>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(b.question!)}
                  className={`text-[10px] ${t.text} opacity-70 hover:opacity-100 transition-opacity flex-shrink-0`}
                  title="Скопировать вопрос"
                >
                  копировать
                </button>
              </div>
            )}
            {tone === 'warning' && b.correction && (
              <div className="ml-3 mt-1 flex gap-1 items-start">
                <span className={`text-[10px] ${t.text} opacity-70 mt-0.5 flex-shrink-0`}>→</span>
                <span className={`text-[11px] ${t.text} opacity-90 leading-relaxed`}>
                  {b.correction}
                </span>
              </div>
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

// ─── Verification questions panel ────────────────────────────────────────────
// "Spot-check" prompts the teacher can ask the student. Pro-tier only. Each
// question may carry a quote citation back into the submission; clicking the
// quote uses the same onCite plumbing as criterion citations.

function VerificationQuestionsPanel({
  items, onCite,
}: { items: VerificationQuestion[]; onCite?: (quote: string) => void }) {
  return (
    <div className="bg-info-bg border border-info/15 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-info uppercase tracking-wide">Спросить студента</div>
        <span
          className="text-[10px] font-sans text-info/70"
          title="Не обвинение в использовании ИИ — просто проверка, понимает ли студент свою работу"
        >
          для устной проверки
        </span>
      </div>
      <ol className="space-y-2 list-decimal list-inside">
        {items.map((q, i) => (
          <li key={i} className="text-[13px] font-sans text-ink leading-relaxed">
            <span>{q.question}</span>
            <button
              type="button"
              onClick={() => navigator.clipboard?.writeText(q.question)}
              className="ml-2 text-[10px] text-info/70 hover:text-info transition-colors"
              title="Скопировать"
            >
              копировать
            </button>
            {q.quote && (
              <button
                type="button"
                onClick={() => onCite?.(q.quote!)}
                title="Показать в работе"
                className="ml-3 mt-0.5 inline-flex items-start gap-1 text-left max-w-full group/cite"
              >
                <span className="text-[10px] mt-0.5 flex-shrink-0 text-info/70">↳</span>
                <span className="text-[11px] italic text-ink-secondary leading-relaxed border-l-2 border-info/30 group-hover/cite:border-info pl-1.5 transition-colors">
                  «{q.quote}»
                  {q.page != null && <span className="not-italic font-normal opacity-70"> · стр. {q.page}</span>}
                </span>
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

// ─── Auto-grow textarea ──────────────────────────────────────────────────────
// Both the per-bullet inputs and the overall summary need to fit the AI's full
// text without clipping or leaving a half-empty pane. We resize on every value
// change so paste, programmatic edits, and typing all keep the height in sync.

function AutoGrowTextarea({
  value,
  onChange,
  disabled,
  className,
  minRows = 1,
}: {
  value: string
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void
  disabled?: boolean
  className?: string
  minRows?: number
}) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      disabled={disabled}
      rows={minRows}
      className={`${className ?? ''} resize-none overflow-hidden`}
    />
  )
}
