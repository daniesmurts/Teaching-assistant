import type { RpdSubmissionStatus, RpdSubmissionStage, RpdSubmissionAction } from '../../../shared/types'

// Pure state machine for the РПД approval workflow (docs/RPD-WORKFLOW.md).
// No DB, no I/O — mirrors services/liveSessions.ts's nextStatus() split
// (pure transition logic, unit-tested; the orchestrator in
// services/rpdSubmissions.ts does the persistence and calls in).

export interface TransitionResult {
  status:          RpdSubmissionStatus
  returnedByStage: RpdSubmissionStage | null
}

/**
 * Returns the next state for `action` from `current`, or null if the action
 * isn't valid from that state (caller should reject with a 409/400, not
 * silently no-op). `returnedByStage` is derived here, not passed in — which
 * stage returned a submission is fully determined by which status it was
 * returned FROM, so there's no separate "who is returning" parameter to get
 * out of sync with the actual authorization gate on the route.
 */
export function applyTransition(
  current: RpdSubmissionStatus,
  action:  RpdSubmissionAction,
): TransitionResult | null {
  switch (action) {
    case 'submit':
      // Fresh submission or a resubmission after being sent back — both land
      // in the same 'submitted' queue the РОП reviews from.
      if (current === 'draft' || current === 'returned') {
        return { status: 'submitted', returnedByStage: null }
      }
      return null

    case 'forward':
      // Only the РОП, only from their own review queue.
      if (current === 'submitted') {
        return { status: 'forwarded', returnedByStage: null }
      }
      return null

    case 'return':
      // РОП not covering — approval requires УМЦ, no branch skips it
      // (docs/RPD-WORKFLOW.md §2: "РОП не может согласовать без УМЦ").
      if (current === 'submitted') return { status: 'returned', returnedByStage: 'rop' }
      if (current === 'forwarded') return { status: 'returned', returnedByStage: 'umc' }
      return null

    case 'approve':
      // Terminal — only УМЦ, only from 'forwarded'. There is deliberately no
      // 'submitted' -> 'approved' transition.
      if (current === 'forwarded') {
        return { status: 'approved', returnedByStage: null }
      }
      return null
  }
}

/** Every action that's a valid next step from `current` — powers which
 *  buttons a queue view renders without duplicating the transition table. */
export function availableActions(current: RpdSubmissionStatus): RpdSubmissionAction[] {
  const actions: RpdSubmissionAction[] = ['submit', 'return', 'forward', 'approve']
  return actions.filter((a) => applyTransition(current, a) !== null)
}
