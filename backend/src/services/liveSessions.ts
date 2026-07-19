import type { LiveSessionStatus, GradeLetter, QuizQuestion } from '../../../shared/types'

// Live QR quiz (TODO.md Feature Y) — the session state machine, extracted as
// a pure function so it's unit-testable without a DB. Everything else in
// this feature is CRUD + aggregation; this is the one piece of real logic.
//
// lobby → question(0) → reveal(0) → question(1) → reveal(1) → … → finished
// "Next" is the single teacher-facing action; which transition it performs
// depends on the current state and whether the current question is the last.

export interface LiveSessionState {
  status:                  LiveSessionStatus
  current_question_index: number
}

export function nextStatus(current: LiveSessionState, totalQuestions: number): LiveSessionState {
  const isLast = current.current_question_index >= totalQuestions - 1

  if (current.status === 'lobby') {
    return { status: 'question', current_question_index: 0 }
  }
  if (current.status === 'question') {
    return { status: 'reveal', current_question_index: current.current_question_index }
  }
  if (current.status === 'reveal') {
    return isLast
      ? { status: 'finished', current_question_index: current.current_question_index }
      : { status: 'question', current_question_index: current.current_question_index + 1 }
  }
  // 'finished' — no further transition; idempotent.
  return current
}

// Scores one participant's raw answers (question_index -> choice_index)
// against the quiz's own correct_index. Shared by the host poll view
// (routes/liveSessions.ts's loadSessionView) and the save-to-journal
// endpoint, so the two never compute a participant's score differently.
export function scoreParticipant(
  questions: QuizQuestion[], answers: Record<string, number>
): { correct: number; total: number } {
  let correct = 0
  questions.forEach((q, i) => { if (answers[String(i)] === q.correct_index) correct++ })
  return { correct, total: questions.length }
}

// Live-quiz score -> the platform's Russian 5-point scale, so a saved
// journal entry plugs directly into student trajectory and cohort
// analytics, both of which are built assuming this scale.
export function scoreToGrade(correct: number, total: number): { grade: GradeLetter; label: string } {
  const pct = total > 0 ? (correct / total) * 100 : 0
  if (pct >= 90) return { grade: '5', label: 'Отлично' }
  if (pct >= 75) return { grade: '4', label: 'Хорошо' }
  if (pct >= 60) return { grade: '3', label: 'Удовлетворительно' }
  return { grade: '2', label: 'Неудовлетворительно' }
}
