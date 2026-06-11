import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const revisionOfId = searchParams.get('revision_of')

  const { data: revisionOf } = useQuery({
    queryKey: ['assignment', revisionOfId],
    queryFn:  () => getAssignment(revisionOfId!),
    enabled:  !!revisionOfId,
  })

  function clearRevision() {
    searchParams.delete('revision_of')
    setSearchParams(searchParams, { replace: true })
  }

  const [submission, setSubmission] = useState<GradeRequest | null>(null)
  const [result, setResult]         = useState<GradeResponse | null>(null)
  const [review, setReview]         = useState<LongReview | null>(null)
  const [mobileTab, setMobileTab]   = useState<MobileTab>('form')

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
              <pre className="flex-1 px-4 py-3 font-mono text-[13px] leading-[1.8] text-ink whitespace-pre-wrap overflow-y-auto">
                {submission?.submission_text}
              </pre>
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
            <GradingResult result={result} onApproved={() => {}} />
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
