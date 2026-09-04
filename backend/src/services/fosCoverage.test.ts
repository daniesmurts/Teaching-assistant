import { describe, it, expect } from 'vitest'
import { checkCoverage, buildPassportRows } from './fosCoverage'
import type { FosSections, Quiz, TaskSet } from '../../../shared/types'

function sections(overrides: Partial<FosSections> = {}): FosSections {
  return {
    passport: { competencies: [], topics: [], rows: [] },
    quiz_ids: [],
    task_sets: [],
    tickets: [],
    criteria: [],
    ...overrides,
  }
}

describe('checkCoverage', () => {
  it('marks a topic covered when it appears in a ticket', () => {
    const s = sections({
      tickets: [{ number: 1, theory_questions: ['Расскажите про термодинамику', 'Q2'], practical_task: 'Task', topics: ['Термодинамика'] }],
    })
    const report = checkCoverage(s, ['Термодинамика'], [])
    expect(report.topics_covered).toEqual(['Термодинамика'])
    expect(report.topics_uncovered).toEqual([])
  })

  it('marks a topic uncovered when it appears nowhere', () => {
    const s = sections({
      tickets: [{ number: 1, theory_questions: ['Q1', 'Q2'], practical_task: 'Task', topics: ['Механика'] }],
    })
    const report = checkCoverage(s, ['Электродинамика'], [])
    expect(report.topics_uncovered).toEqual(['Электродинамика'])
    expect(report.topics_covered).toEqual([])
  })

  it('finds coverage in quiz questions', () => {
    const quiz: Quiz = {
      id: '1', teacher_id: 't', course_id: null, course_name: null, presentation_id: null, topic: 'x', level: null, question_count: 1,
      questions: [{ question: 'Что такое электромагнетизм?', options: ['a', 'b', 'c', 'd'], correct_index: 0, explanation: '', citations: [] }],
      sources: null, created_at: '',
    }
    const report = checkCoverage(sections(), ['Электромагнетизм'], [], [quiz])
    expect(report.topics_covered).toEqual(['Электромагнетизм'])
  })

  it('finds coverage in task statements', () => {
    const taskSet: TaskSet = {
      id: '1', teacher_id: 't', course_id: null, course_name: null, kind: 'assignment', topic: 'x', difficulty: 'basic',
      tasks: [{ title: 'Задание', statement: 'Решите задачу по гидравлике', skills: '' }], created_at: '',
    }
    const report = checkCoverage(sections(), ['Гидравлика'], [], [], [taskSet])
    expect(report.topics_covered).toEqual(['Гидравлика'])
  })

  it('flags an uncovered competency not present in passport rows', () => {
    const s = sections({ passport: { competencies: ['ПК-1'], topics: [], rows: [{ competency: 'ПК-1', topic: 'x', instruments: [] }] } })
    const report = checkCoverage(s, [], ['ПК-1', 'ПК-2'])
    expect(report.competencies_uncovered).toEqual(['ПК-2'])
  })

  it('raises a balance warning when one topic dominates the tickets', () => {
    const tickets = Array.from({ length: 10 }, (_, i) => ({
      number: i + 1, theory_questions: ['Q1', 'Q2'], practical_task: 'Task',
      topics: i < 8 ? ['Доминирующая тема'] : ['Редкая тема'],
    }))
    const report = checkCoverage(sections({ tickets }), [], [])
    expect(report.balance_warning).toContain('Доминирующая тема')
    expect(report.balance_warning).toContain('8 из 10')
  })

  it('returns no balance warning when topics are evenly spread', () => {
    const tickets = Array.from({ length: 4 }, (_, i) => ({
      number: i + 1, theory_questions: ['Q1', 'Q2'], practical_task: 'Task', topics: [`Тема ${i}`],
    }))
    const report = checkCoverage(sections({ tickets }), [], [])
    expect(report.balance_warning).toBeNull()
  })

  it('returns no balance warning with zero tickets', () => {
    const report = checkCoverage(sections(), [], [])
    expect(report.balance_warning).toBeNull()
  })
})

describe('buildPassportRows', () => {
  it('lists which instrument types reference each topic', () => {
    const quiz: Quiz = {
      id: '1', teacher_id: 't', course_id: null, course_name: null, presentation_id: null, topic: 'x', level: null, question_count: 1,
      questions: [{ question: 'Что такое гидравлика?', options: ['a', 'b', 'c', 'd'], correct_index: 0, explanation: '', citations: [] }],
      sources: null, created_at: '',
    }
    const tickets = [{ number: 1, theory_questions: ['Q1', 'Q2'], practical_task: 'Task', topics: ['Гидравлика'] }]
    const rows = buildPassportRows(['Гидравлика', 'Термодинамика'], [quiz], [], tickets)
    expect(rows[0]).toEqual({ competency: null, topic: 'Гидравлика', instruments: ['Тест', 'Билет №1'] })
    expect(rows[1]).toEqual({ competency: null, topic: 'Термодинамика', instruments: [] })
  })
})
