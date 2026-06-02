import { useState } from 'react'
import TopBar from '../components/layout/TopBar'
import GradingForm from '../components/grading/GradingForm'
import GradingResult from '../components/grading/GradingResult'
import type { GradeRequest, GradeResponse } from '../api/grading'

export default function Grading() {
  const [submission, setSubmission] = useState<GradeRequest | null>(null)
  const [result, setResult]         = useState<GradeResponse | null>(null)

  function handleResult(req: GradeRequest, res: GradeResponse) {
    setSubmission(req)
    setResult(res)
  }

  function reset() {
    setSubmission(null)
    setResult(null)
  }

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Grading"
        actions={result && (
          <button onClick={reset} className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors">
            ← New submission
          </button>
        )}
      />

      <div className="flex-1 flex overflow-hidden">
        {/* Left panel — form or submission text */}
        <div className="w-[38%] border-r border-border bg-surface-warm overflow-y-auto flex flex-col">
          {!result ? (
            <GradingForm onResult={handleResult} />
          ) : (
            <div className="flex flex-col h-full">
              <div className="px-4 py-3 border-b border-border">
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1">
                  Student submission
                </div>
                {submission?.student_name && (
                  <div className="text-sm font-sans font-medium text-ink">{submission.student_name}</div>
                )}
              </div>
              <pre className="flex-1 px-4 py-3 font-mono text-[13px] leading-[1.8] text-ink whitespace-pre-wrap overflow-y-auto">
                {submission?.submission_text}
              </pre>
            </div>
          )}
        </div>

        {/* Right panel — result or empty state */}
        <div className="flex-1 bg-surface overflow-y-auto flex flex-col">
          {!result ? (
            <div className="flex-1 flex items-center justify-center p-8 text-center">
              <div>
                <div className="font-display text-5xl text-ink-tertiary mb-3">✦</div>
                <p className="font-sans text-sm text-ink-secondary max-w-xs">
                  Paste a student submission on the left and click <strong>Grade with AI</strong>.
                  Results will appear here.
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
