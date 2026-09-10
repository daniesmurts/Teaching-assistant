import { useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import {
  answerSatisfaction, commentSatisfaction, dismissSatisfaction, type SatisfactionScore,
} from '../../api/satisfaction'

// Micro-satisfaction bar (TODO Feature SAT, Phase 1).
//
// Deliberately a bar and not a modal: it must be ignorable. Everything about
// this component assumes the teacher would rather be doing something else —
// no focus trap, no backdrop, nothing that blocks the page, and a × that is a
// real answer (recorded as a dismissal) rather than a way to postpone.
//
// The question is passed in by the trigger, not hardcoded: «Как прошло?» is
// meaningless when a teacher has used exactly one feature. What we ask about
// grading is whether the grade needed rewriting — a thing they can answer from
// what just happened, rather than a mood. The score stays 1..3 with 1 = worst
// so features remain comparable to each other; only the wording moves.
//
// Not called "feedback" anywhere in this file on purpose. In this codebase
// that word already means the teacher's written feedback to a student
// (Feedback.tsx, FeedbackLibrary, ai_feedback, approved_feedback,
// feedback_challenges) and a fifth meaning would collide in every conversation
// about it.

export default function SatisfactionPrompt() {
  const promptId = useUIStore((s) => s.satisfactionPromptId)
  const ask = useUIStore((s) => s.satisfactionAsk)
  const hide = useUIStore((s) => s.hideSatisfaction)

  const [answered, setAnswered] = useState(false)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')
  const [sent, setSent] = useState(false)

  if (!promptId || !ask) return null

  function reset() {
    setAnswered(false); setCommenting(false); setComment(''); setSent(false)
    hide()
  }

  function answer(score: SatisfactionScore) {
    setAnswered(true)
    // Fire-and-forget: the thank-you must not wait on the network, and a
    // failed rating is not something to interrupt the teacher about.
    answerSatisfaction(promptId!, score).catch(() => null)
  }

  function sendComment() {
    const text = comment.trim()
    if (text.length < 2) return
    commentSatisfaction(promptId!, text).catch(() => null)
    setSent(true)
    setTimeout(reset, 1600)
  }

  function dismiss() {
    dismissSatisfaction(promptId!)
    reset()
  }

  return (
    <div className="fixed bottom-4 left-0 right-0 md:left-[210px] z-40 px-4 flex justify-center pointer-events-none">
      <div className="w-full max-w-[560px] rounded-lg bg-ink text-white shadow-lg px-4 py-3 font-sans text-sm pointer-events-auto">
        {sent ? (
          <p className="text-white/80">Спасибо — прочитаем.</p>
        ) : commenting ? (
          <div className="flex items-center gap-2">
            <input
              autoFocus
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') sendComment() }}
              placeholder="Что стоит поправить?"
              maxLength={2000}
              className="flex-1 bg-white/10 rounded-md px-3 py-1.5 text-white placeholder-white/40 outline-none focus:bg-white/15"
            />
            <button onClick={sendComment} className="text-white/90 hover:text-white whitespace-nowrap">Отправить</button>
            <button onClick={reset} aria-label="Закрыть" className="text-white/50 hover:text-white/90 px-1">✕</button>
          </div>
        ) : answered ? (
          <div className="flex items-center gap-4">
            <span>Спасибо за оценку.</span>
            <button onClick={() => setCommenting(true)} className="text-white/60 hover:text-white/90">Рассказать подробнее</button>
            <button onClick={reset} aria-label="Закрыть" className="text-white/50 hover:text-white/90 ml-auto px-1">✕</button>
          </div>
        ) : (
          <div className="flex items-center gap-x-3 gap-y-2 flex-wrap">
            <span className="flex-1 min-w-[14rem]">{ask.question}</span>
            <div className="flex items-center gap-2 shrink-0 ml-auto">
              {ask.labels.map((label, i) => (
                <button
                  key={label}
                  onClick={() => answer((i + 1) as SatisfactionScore)}
                  className="px-3 py-1 rounded-md bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap"
                >
                  {label}
                </button>
              ))}
              <button onClick={dismiss} aria-label="Закрыть" className="text-white/50 hover:text-white/90 px-1">✕</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
