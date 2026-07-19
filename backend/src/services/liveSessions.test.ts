import { describe, it, expect } from 'vitest'
import { nextStatus, scoreParticipant, scoreToGrade } from './liveSessions'
import type { QuizQuestion } from '../../../shared/types'

function q(correctIndex: number): QuizQuestion {
  return { question: 'Q', options: ['a', 'b', 'c', 'd'], correct_index: correctIndex, explanation: 'e', citations: [] }
}

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

describe('scoreParticipant', () => {
  it('counts answers matching the correct_index', () => {
    const questions = [q(1), q(2), q(0)]
    expect(scoreParticipant(questions, { '0': 1, '1': 2, '2': 3 })).toEqual({ correct: 2, total: 3 })
  })

  it('treats an unanswered question as incorrect, not a crash', () => {
    const questions = [q(1), q(2)]
    expect(scoreParticipant(questions, { '0': 1 })).toEqual({ correct: 1, total: 2 })
  })

  it('handles zero answers', () => {
    const questions = [q(1), q(2)]
    expect(scoreParticipant(questions, {})).toEqual({ correct: 0, total: 2 })
  })
})

describe('scoreToGrade', () => {
  it('grades 90%+ as 5', () => {
    expect(scoreToGrade(9, 10)).toEqual({ grade: '5', label: 'Отлично' })
    expect(scoreToGrade(10, 10)).toEqual({ grade: '5', label: 'Отлично' })
  })

  it('grades 75-89% as 4', () => {
    expect(scoreToGrade(8, 10)).toEqual({ grade: '4', label: 'Хорошо' })
  })

  it('grades 60-74% as 3', () => {
    expect(scoreToGrade(6, 10)).toEqual({ grade: '3', label: 'Удовлетворительно' })
  })

  it('grades below 60% as 2', () => {
    expect(scoreToGrade(3, 10)).toEqual({ grade: '2', label: 'Неудовлетворительно' })
    expect(scoreToGrade(0, 10)).toEqual({ grade: '2', label: 'Неудовлетворительно' })
  })

  it('treats zero questions as 0% rather than dividing by zero', () => {
    expect(scoreToGrade(0, 0)).toEqual({ grade: '2', label: 'Неудовлетворительно' })
  })
})
