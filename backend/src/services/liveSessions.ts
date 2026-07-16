import type { LiveSessionStatus } from '../../../shared/types'

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
