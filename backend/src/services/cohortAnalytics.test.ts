import { describe, it, expect } from 'vitest'
import { computeCohortAnalytics, type CohortRow } from './cohortAnalytics'

let seq = 0
function row(overrides: Partial<CohortRow>): CohortRow {
  seq++
  return {
    student_name:    overrides.student_name ?? `Студент ${seq}`,
    student_group:   overrides.student_group ?? null,
    created_at:      overrides.created_at ?? '2026-06-01T10:00:00Z',
    score:           overrides.score ?? 80,
    grade:           overrides.grade ?? '4',
    criteria_scores: overrides.criteria_scores ?? null,
  }
}

describe('computeCohortAnalytics', () => {
  it('builds the overall grade histogram', () => {
    const result = computeCohortAnalytics([
      row({ grade: '5' }), row({ grade: '5' }), row({ grade: '4' }), row({ grade: '2' }),
    ])
    expect(result.histogram).toEqual({ '5': 2, '4': 1, '2': 1 })
    expect(result.total_submissions).toBe(4)
  })

  it('counts distinct students by (name, group), not by row', () => {
    const result = computeCohortAnalytics([
      row({ student_name: 'Иванов', student_group: '101' }),
      row({ student_name: 'Иванов', student_group: '101' }),
      row({ student_name: 'Иванов', student_group: '102' }), // same name, different group = different student
    ])
    expect(result.total_students).toBe(2)
  })

  it('breaks grades down per group, sorted alphabetically with null last', () => {
    const result = computeCohortAnalytics([
      row({ student_group: '102', score: 90, grade: '5' }),
      row({ student_group: '101', score: 60, grade: '3' }),
      row({ student_group: null, score: 50, grade: '2' }),
    ])
    expect(result.by_group.map((g) => g.group)).toEqual(['101', '102', null])
    expect(result.by_group[0].avg_score).toBe(60)
    expect(result.by_group[0].histogram).toEqual({ '3': 1 })
  })

  it('finds the lowest-scoring criteria with enough samples, ignoring thin ones', () => {
    const result = computeCohortAnalytics([
      row({ criteria_scores: [{ name: 'Аргументация', score: 40, feedback: '' }, { name: 'Оформление', score: 90, feedback: '' }] }),
      row({ criteria_scores: [{ name: 'Аргументация', score: 50, feedback: '' }, { name: 'Оформление', score: 85, feedback: '' }] }),
      row({ criteria_scores: [{ name: 'Аргументация', score: 45, feedback: '' }, { name: 'Оформление', score: 95, feedback: '' }] }),
      // Redkiy criterion appears only once — below MIN_CRITERION_SAMPLE, must be excluded.
      row({ criteria_scores: [{ name: 'Редкий критерий', score: 10, feedback: '' }] }),
    ])
    expect(result.top_missed_criteria[0].name).toBe('Аргументация')
    expect(result.top_missed_criteria[0].avg_score).toBeCloseTo(45)
    expect(result.top_missed_criteria.find((c) => c.name === 'Редкий критерий')).toBeUndefined()
  })

  it('matches criteria case-insensitively across rows', () => {
    const result = computeCohortAnalytics([
      row({ criteria_scores: [{ name: 'аргументация', score: 40, feedback: '' }] }),
      row({ criteria_scores: [{ name: 'Аргументация', score: 60, feedback: '' }] }),
      row({ criteria_scores: [{ name: ' Аргументация ', score: 50, feedback: '' }] }),
    ])
    expect(result.top_missed_criteria).toHaveLength(1)
    expect(result.top_missed_criteria[0].count).toBe(3)
  })

  it('flags a student whose recent scores dropped meaningfully vs. their prior average', () => {
    const result = computeCohortAnalytics([
      row({ student_name: 'Петров', created_at: '2026-06-01T00:00:00Z', score: 90 }),
      row({ student_name: 'Петров', created_at: '2026-06-05T00:00:00Z', score: 88 }),
      row({ student_name: 'Петров', created_at: '2026-06-10T00:00:00Z', score: 55 }),
      row({ student_name: 'Петров', created_at: '2026-06-15T00:00:00Z', score: 50 }),
    ])
    expect(result.slipping).toHaveLength(1)
    expect(result.slipping[0].student_name).toBe('Петров')
    expect(result.slipping[0].delta).toBeLessThanOrEqual(-8)
  })

  it('does not flag a student with too few submissions or a small dip', () => {
    const tooFew = computeCohortAnalytics([
      row({ student_name: 'A', created_at: '2026-06-01T00:00:00Z', score: 90 }),
      row({ student_name: 'A', created_at: '2026-06-02T00:00:00Z', score: 50 }),
    ])
    expect(tooFew.slipping).toHaveLength(0)

    const smallDip = computeCohortAnalytics([
      row({ student_name: 'B', created_at: '2026-06-01T00:00:00Z', score: 80 }),
      row({ student_name: 'B', created_at: '2026-06-02T00:00:00Z', score: 80 }),
      row({ student_name: 'B', created_at: '2026-06-03T00:00:00Z', score: 78 }),
      row({ student_name: 'B', created_at: '2026-06-04T00:00:00Z', score: 77 }),
    ])
    expect(smallDip.slipping).toHaveLength(0)
  })

  it('handles a student name containing a space without corrupting the group', () => {
    const result = computeCohortAnalytics([
      row({ student_name: 'Иванов И. А.', student_group: '101', created_at: '2026-06-01T00:00:00Z', score: 90 }),
      row({ student_name: 'Иванов И. А.', student_group: '101', created_at: '2026-06-02T00:00:00Z', score: 88 }),
      row({ student_name: 'Иванов И. А.', student_group: '101', created_at: '2026-06-03T00:00:00Z', score: 50 }),
      row({ student_name: 'Иванов И. А.', student_group: '101', created_at: '2026-06-04T00:00:00Z', score: 45 }),
    ])
    expect(result.slipping).toHaveLength(1)
    expect(result.slipping[0].student_name).toBe('Иванов И. А.')
    expect(result.slipping[0].student_group).toBe('101')
  })

  it('sorts slipping students most-declined first and caps at the limit', () => {
    const rows: CohortRow[] = []
    // Every student here qualifies (delta well past the -8 threshold); only
    // the ordering + cap at SLIPPING_LIMIT is under test.
    for (let i = 0; i < 15; i++) {
      const name = `Студент ${i}`
      rows.push(row({ student_name: name, created_at: '2026-06-01T00:00:00Z', score: 90 }))
      rows.push(row({ student_name: name, created_at: '2026-06-02T00:00:00Z', score: 90 }))
      rows.push(row({ student_name: name, created_at: '2026-06-03T00:00:00Z', score: 90 - 10 - i }))
      rows.push(row({ student_name: name, created_at: '2026-06-04T00:00:00Z', score: 90 - 10 - i }))
    }
    const result = computeCohortAnalytics(rows)
    expect(result.slipping).toHaveLength(10)
    for (let i = 1; i < result.slipping.length; i++) {
      expect(result.slipping[i].delta).toBeGreaterThanOrEqual(result.slipping[i - 1].delta)
    }
  })

  it('returns empty structures for an empty cohort', () => {
    const result = computeCohortAnalytics([])
    expect(result.total_students).toBe(0)
    expect(result.total_submissions).toBe(0)
    expect(result.histogram).toEqual({})
    expect(result.by_group).toEqual([])
    expect(result.top_missed_criteria).toEqual([])
    expect(result.slipping).toEqual([])
  })
})
