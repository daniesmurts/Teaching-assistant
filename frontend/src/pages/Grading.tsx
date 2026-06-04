import { useState } from 'react'
import TopBar from '../components/layout/TopBar'
import GradingForm from '../components/grading/GradingForm'
import GradingResult from '../components/grading/GradingResult'
import type { GradeRequest, GradeResponse } from '../api/grading'

type MobileTab = 'form' | 'result'

export default function Grading() {
  const [submission, setSubmission] = useState<GradeRequest | null>(null)
  const [result, setResult]         = useState<GradeResponse | null>(null)
  const [mobileTab, setMobileTab]   = useState<MobileTab>('form')

  function handleResult(req: GradeRequest, res: GradeResponse) {
    setSubmission(req)
    setResult(res)
    setMobileTab('result')
  }

  function reset() {
    setSubmission(null)
    setResult(null)
    setMobileTab('form')
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
        actions={result && (
          <button onClick={reset} className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors">
            ← Новая работа
          </button>
        )}
      />

      {/* Mobile tab switcher — only visible after grading */}
      {result && (
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
          ${result ? (mobileTab === 'form' ? 'flex w-full' : 'hidden') : 'flex w-full'}
          md:flex md:w-[38%]
        `}>
          {!result ? (
            <GradingForm onResult={handleResult} />
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
          ${result ? (mobileTab === 'result' ? 'flex' : 'hidden') : 'hidden'}
          md:flex
        `}>
          {!result ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <div className="font-display text-5xl text-ink-tertiary mb-3">✦</div>
                <p className="font-sans text-sm text-ink-secondary max-w-xs">
                  Вставьте работу студента слева и нажмите <strong>Проверить с ИИ</strong>.
                  Результаты появятся здесь.
                </p>
              </div>
            </div>
          ) : (
            <GradingResult result={result} onApproved={() => {}} />
          )}
        </div>

      </div>
    </div>
  )
}
