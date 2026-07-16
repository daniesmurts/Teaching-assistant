import { describe, it, expect } from 'vitest'
import { normaliseTickets } from './fosTickets'

describe('normaliseTickets', () => {
  it('keeps well-formed tickets and renumbers sequentially', () => {
    const tickets = normaliseTickets(
      [
        { theory_questions: ['Q1', 'Q2'], practical_task: 'Do X', topics: ['A'] },
        { theory_questions: ['Q3', 'Q4'], practical_task: 'Do Y', topics: ['B'] },
      ],
      10
    )
    expect(tickets).toHaveLength(2)
    expect(tickets.map((t) => t.number)).toEqual([1, 2])
  })

  it('drops tickets with fewer than 2 theory questions', () => {
    const tickets = normaliseTickets(
      [
        { theory_questions: ['Q1'], practical_task: 'Do X', topics: [] },
        { theory_questions: ['Q1', 'Q2'], practical_task: 'Do X', topics: [] },
      ],
      10
    )
    expect(tickets).toHaveLength(1)
  })

  it('drops tickets missing a practical task', () => {
    const tickets = normaliseTickets(
      [{ theory_questions: ['Q1', 'Q2'], practical_task: '', topics: [] }],
      10
    )
    expect(tickets).toHaveLength(0)
  })

  it('trims theory questions beyond 2 and defaults missing topics to an empty array', () => {
    const tickets = normaliseTickets(
      [{ theory_questions: ['Q1', 'Q2', 'Q3'], practical_task: 'Do X' }],
      10
    )
    expect(tickets[0].theory_questions).toEqual(['Q1', 'Q2'])
    expect(tickets[0].topics).toEqual([])
  })

  it('caps output at targetCount', () => {
    const raw = Array.from({ length: 5 }, (_, i) => ({
      theory_questions: [`Q${i}a`, `Q${i}b`], practical_task: `Task ${i}`, topics: [],
    }))
    const tickets = normaliseTickets(raw, 3)
    expect(tickets).toHaveLength(3)
    expect(tickets.map((t) => t.number)).toEqual([1, 2, 3])
  })

  it('handles undefined input', () => {
    expect(normaliseTickets(undefined, 10)).toEqual([])
  })
})
