import { describe, it, expect } from 'vitest'
import { nextStatus } from './liveSessions'

describe('nextStatus', () => {
  it('advances lobby to question 0', () => {
    expect(nextStatus({ status: 'lobby', current_question_index: 0 }, 5))
      .toEqual({ status: 'question', current_question_index: 0 })
  })

  it('advances question(i) to reveal(i), same index', () => {
    expect(nextStatus({ status: 'question', current_question_index: 2 }, 5))
      .toEqual({ status: 'reveal', current_question_index: 2 })
  })

  it('advances reveal(i) to question(i+1) when not the last question', () => {
    expect(nextStatus({ status: 'reveal', current_question_index: 2 }, 5))
      .toEqual({ status: 'question', current_question_index: 3 })
  })

  it('advances reveal(last) to finished', () => {
    expect(nextStatus({ status: 'reveal', current_question_index: 4 }, 5))
      .toEqual({ status: 'finished', current_question_index: 4 })
  })

  it('is idempotent once finished', () => {
    expect(nextStatus({ status: 'finished', current_question_index: 4 }, 5))
      .toEqual({ status: 'finished', current_question_index: 4 })
  })

  it('handles a single-question quiz — question(0) reveal goes straight to finished', () => {
    expect(nextStatus({ status: 'reveal', current_question_index: 0 }, 1))
      .toEqual({ status: 'finished', current_question_index: 0 })
  })
})
