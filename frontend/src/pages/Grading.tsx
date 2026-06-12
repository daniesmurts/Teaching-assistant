import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { usePersistedState, clearPersistedState } from '../hooks/usePersistedState'
import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import GradingForm from '../components/grading/GradingForm'
import GradingResult from '../components/grading/GradingResult'
import ReviewResult from '../components/grading/ReviewResult'
import { getAssignment, type GradeRequest, type GradeResponse } from '../api/grading'
import type { LongReview } from '../types'

type MobileTab = 'form' | 'result'

export default function Grading() {
  // ?revision_of=<assignment id> means «open the form, pre-filled, ready to grade
  // a re-submission of that work». Read once on mount; teacher can clear it.
  // ?resume=<assignment id> means «rehydrate the result panel for this pending
  // assignment so the teacher can finish approving it».
  const [searchParams, setSearchParams] = useSearchParams()
  const revisionOfId = searchParams.get('revision_of')
  const resumeId     = searchParams.get('resume')

  const { data: revisionOf } = useQuery({
    queryKey: ['assignment', revisionOfId],
    queryFn:  () => getAssignment(revisionOfId!),
    enabled:  !!revisionOfId,
  })

  const { data: resumeAssignment } = useQuery({
    queryKey: ['assignment', resumeId],
    queryFn:  () => getAssignment(resumeId!),
    enabled:  !!resumeId,
  })

  function clearRevision() {
    searchParams.delete('revision_of')
    setSearchParams(searchParams, { replace: true })
  }

  // The submitted request + AI result persist across page refreshes so a
  // teacher doesn't lose work to an accidental reload. Cleared on approve and
  // on the "Новая проверка" button. See usePersistedState for the contract.
  const [submission, setSubmission] = usePersistedState<GradeRequest | null>('page:submission', null)
  const [result, setResult]         = usePersistedState<GradeResponse | null>('page:result',     null)
  const [review, setReview]         = usePersistedState<LongReview | null>(  'page:review',     null)
  const [mobileTab, setMobileTab]   = useState<MobileTab>('form')
  // Highlight is ephemeral UX state — don't carry it across refreshes.
  const [highlight, setHighlight]   = useState<string | null>(null)

  // ?resume=<id>: rehydrate the result panel from an existing pending
  // assignment so the teacher can finish their review. We do this once per
  // resumeId — any in-progress draft on this page is discarded in favour of
  // the explicit "Подтвердить оценку" intent from History.
  const resumedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!resumeAssignment || resumedRef.current === resumeAssignment.id) return
    if (resumeAssignment.status !== 'pending') {
      // Already approved/sent — drop the param, do nothing else.
      searchParams.delete('resume')
      setSearchParams(searchParams, { replace: true })
      return
    }
    resumedRef.current = resumeAssignment.id
    setSubmission({
      submission_text: resumeAssignment.submission_text,
      ...(resumeAssignment.course_id     ? { course_id:     resumeAssignment.course_id }     : {}),
      ...(resumeAssignment.student_name  ? { student_name:  resumeAssignment.student_name }  : {}),
      ...(resumeAssignment.student_email ? { student_email: resumeAssignment.student_email } : {}),
      ...(resumeAssignment.student_group ? { student_group: resumeAssignment.student_group } : {}),
    })
    setReview(null)
    setResult({
      assignment_id:        resumeAssignment.id,
      ai_score:             resumeAssignment.ai_score             ?? 0,
      ai_grade:             resumeAssignment.ai_grade             ?? '3',
      ai_grade_label:       resumeAssignment.ai_grade_label       ?? '',
      ai_feedback:          resumeAssignment.ai_feedback          ?? '',
      ai_criteria_scores:   resumeAssignment.ai_criteria_scores   ?? [],
      ai_strengths:         resumeAssignment.ai_strengths         ?? [],
      ai_improvements:      resumeAssignment.ai_improvements      ?? [],
      ai_revision_check:    resumeAssignment.ai_revision_check    ?? null,
      criteria_snapshot:    resumeAssignment.criteria_snapshot    ?? null,
      ai_confidence:        resumeAssignment.ai_confidence        ?? null,
      ai_ensemble:          resumeAssignment.ai_ensemble          ?? null,
      used_examples:        0,   // not tracked on the assignment row
      revision_number:      resumeAssignment.revision_number,
      parent_assignment_id: resumeAssignment.parent_assignment_id,
    })
    setMobileTab('result')
    // Clean the URL — refresh from here should keep the rehydrated state via
    // localStorage, not re-fetch.
    searchParams.delete('resume')
    setSearchParams(searchParams, { replace: true })
  }, [resumeAssignment, searchParams, setSearchParams, setSubmission, setResult, setReview])

  const hasOutput = result !== null || review !== null

  function handleResult(req: GradeRequest, res: GradeResponse) {
    setSubmission(req)
    setReview(null)
    setResult(res)
    setMobileTab('result')
  }

  function handleReview(rev: LongReview, req: GradeRequest) {
    setSubmission(req)
    setResult(null)
    setReview(rev)
    setMobileTab('result')
  }

  function reset() {
    setSubmission(null)
    setResult(null)
    setReview(null)
    setMobileTab('form')
    // Wipe the in-progress form draft too — the teacher explicitly asked
    // for a fresh round, they don't want yesterday's submission text back.
    clearPersistedState('form:draft.fields')
    clearPersistedState('form:draft.criteria')
    clearPersistedState('review:pending')
    // Also drop the ?revision_of= param so a fresh round isn't still pre-filled
    if (revisionOfId) clearRevision()
  }

  const tabClass = (t: MobileTab) =>
    `flex-1 py-2 text-xs font-sans font-medium transition-colors border-b-2 ${
      mobileTab === t
        ? 'border-amber text-amber'
        : 'border-transparent text-ink-secondary'
    }`

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar
        title="Проверка работ"
        actions={hasOutput && (
          <button onClick={reset} className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors">
            ← Новая работа
          </button>
        )}
      />

      {/* How-it-works intro — only before the first grading */}
      {!hasOutput && (
        <div className="px-4 md:px-6 pt-5 flex-shrink-0">
          <div className="max-w-[960px] mx-auto">
            <FeatureIntro
              id="grading"
              title="Проверка работ — ИИ оценивает и даёт обратную связь"
              description="Вставьте текст работы (или загрузите PDF, Word, скан), при желании выберите критерии — и ИИ поставит оценку с разбором по пунктам, сильными сторонами и рекомендациями. Вы проверяете результат и подтверждаете его — финальное слово всегда за вами."
              steps={[
                'Вставьте работу студента слева или загрузите файл — текст подставится автоматически.',
                'По желанию выберите предмет и рубрику; для задач по физике/математике включите «Расчётная задача».',
                'Проверьте оценку и отзыв, при необходимости отредактируйте и нажмите «Подтвердить».',
              ]}
            />
          </div>
        </div>
      )}

      {/* Mobile tab switcher — only visible after grading */}
      {hasOutput && (
        <div className="md:hidden flex border-b border-border bg-surface flex-shrink-0">
          <button className={tabClass('form')} onClick={() => setMobileTab('form')}>
            Работа
          </button>
          <button className={tabClass('result')} onClick={() => setMobileTab('result')}>
            Результат
          </button>
        </div>
      )}

      {/* Desktop: side-by-side. Mobile: single panel controlled by tab */}
      <div className="flex-1 flex overflow-hidden">

        {/* Left panel */}
        <div className={`
          md:w-[38%] md:border-r md:border-border md:flex bg-surface-warm overflow-y-auto flex-col
          ${hasOutput ? (mobileTab === 'form' ? 'flex w-full' : 'hidden') : 'flex w-full'}
          md:flex md:w-[38%]
        `}>
          {!hasOutput ? (
            <GradingForm
              onResult={handleResult}
              onReview={handleReview}
              revisionOf={revisionOf ?? null}
              onClearRevision={clearRevision}
            />
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1">
                  Работа студента
                </div>
                {submission?.student_name && (
                  <div className="text-sm font-sans font-medium text-ink">
                    {submission.student_name}
                    {submission.student_group && <span className="text-ink-tertiary font-normal"> · {submission.student_group}</span>}
                  </div>
                )}
              </div>
              <SubmissionPane text={submission?.submission_text ?? ''} highlight={highlight} />
            </div>
          )}
        </div>

        {/* Right panel */}
        <div className={`
          flex-1 bg-surface overflow-y-auto flex-col
          ${hasOutput ? (mobileTab === 'result' ? 'flex' : 'hidden') : 'hidden'}
          md:flex
        `}>
          {result ? (
            <GradingResult
              result={result}
              onApproved={() => {}}
              onCite={(quote) => {
                setHighlight(quote)
                setMobileTab('form')   // mobile: jump to the submission pane
              }}
            />
          ) : review ? (
            <ReviewResult review={review} onApproved={() => {}} />
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <div className="font-display text-5xl text-ink-tertiary mb-3">✦</div>
                <p className="font-sans text-sm text-ink-secondary max-w-xs">
                  Вставьте работу студента слева и нажмите <strong>Проверить с ИИ</strong>.
                  Результаты появятся здесь.
                </p>
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  )
}

/**
 * Renders the student submission with an optional quote highlighted in amber.
 * The first match (case- and whitespace-insensitive) is wrapped in a <mark>
 * and scrolled into view whenever the highlight target changes.
 */
function SubmissionPane({ text, highlight }: { text: string; highlight: string | null }) {
  const markRef = useRef<HTMLElement | null>(null)

  // Locate the first case-/whitespace-insensitive match. If none, render plain.
  const segments = useMemo(() => findHighlight(text, highlight), [text, highlight])

  useEffect(() => {
    if (markRef.current) {
      markRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlight, segments])

  return (
    <pre className="flex-1 px-4 py-3 font-mono text-[13px] leading-[1.8] text-ink whitespace-pre-wrap overflow-y-auto">
      {segments.before}
      {segments.match && (
        <mark
          ref={markRef}
          className="bg-amber-light text-ink rounded-sm px-0.5 -mx-0.5 ring-1 ring-amber/40"
        >
          {segments.match}
        </mark>
      )}
      {segments.after}
    </pre>
  )
}

export function findHighlight(text: string, quote: string | null): { before: string; match: string; after: string } {
  if (!quote || !text) return { before: text, match: '', after: '' }
  const normText  = text.toLowerCase().replace(/\s+/g, ' ')
  const normQuote = quote.toLowerCase().replace(/\s+/g, ' ').trim()
  if (normQuote.length < 4) return { before: text, match: '', after: '' }

  // Walk the original text, advancing a normalized cursor alongside it. The
  // mapping lets us pick the original substring whose normalized form equals
  // the quote — preserving the original whitespace/casing for display.
  const map: number[] = []
  let norm = ''
  let prevWasSpace = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (/\s/.test(ch)) {
      if (!prevWasSpace && norm.length > 0) {
        norm += ' '
        map.push(i)
        prevWasSpace = true
      }
    } else {
      norm += ch.toLowerCase()
      map.push(i)
      prevWasSpace = false
    }
  }
  const startNorm = norm.indexOf(normQuote)
  if (startNorm === -1) return { before: text, match: '', after: '' }
  const endNorm   = startNorm + normQuote.length
  const startOrig = map[startNorm] ?? 0
  const endOrig   = (map[endNorm - 1] ?? text.length - 1) + 1
  return {
    before: text.slice(0, startOrig),
    match:  text.slice(startOrig, endOrig),
    after:  text.slice(endOrig),
  }
}
