import { describe, it, expect } from 'vitest'
import { buildChains, computeStudentStats, formatHours, jaccardSimilarity, tokenize } from './studentStats'
import type { Assignment, RevisionCheckItem } from '../types'

// Minimal assignment factory — only the fields studentStats reads. Default
// submission_text is empty (tokenizes to an empty set, so jaccardSimilarity
// is always 0 against it) so tests that don't care about text content never
// accidentally trip the similarity-based grouping; tests that do set a real
// submission_text explicitly.
let seq = 0
function make(overrides: Partial<Assignment>): Assignment {
  seq++
  return {
    id: overrides.id ?? `a${seq}`,
    course_id: null,
    parent_assignment_id: null,
    revision_number: 1,
    created_at: '2026-06-01T10:00:00Z',
    ai_score: 60,
    approved_score: null,
    ai_revision_check: null,
    submission_text: overrides.submission_text ?? '',
    ...overrides,
  } as Assignment
}

// Two texts that share the same section headings (like the real product's
// "СОДЕРЖАНИЕ 1. Введение..." boilerplate) but differ in body numbers —
// close enough to trip the similarity threshold.
const SIMILAR_TEXT_A = 'СОДЕРЖАНИЕ 1. Введение 5 2. Описание технологии процесса 6 3. Описание технологической схемы аппарат с позициями Исходные данные для расчета'
const SIMILAR_TEXT_B = 'СОДЕРЖАНИЕ 1. Введение 2 2. Описание технологии процесса 3 3. Описание технологической схемы аппарат с позициями Исходные данные для расчета'

const check = (statuses: RevisionCheckItem['status'][]): RevisionCheckItem[] =>
  statuses.map((status, i) => ({ point: `p${i}`, status, note: '' }))

describe('buildChains', () => {
  it('groups revisions under their original and sorts versions chronologically', () => {
    const original = make({ id: 'orig', created_at: '2026-06-01T10:00:00Z' })
    const rev2 = make({ id: 'rev2', parent_assignment_id: 'orig', revision_number: 2, created_at: '2026-06-03T10:00:00Z' })
    const rev3 = make({ id: 'rev3', parent_assignment_id: 'rev2', revision_number: 3, created_at: '2026-06-05T10:00:00Z' })
    const solo = make({ id: 'solo', created_at: '2026-06-10T10:00:00Z' })

    const chains = buildChains([rev3, solo, original, rev2]) // shuffled input
    expect(chains).toHaveLength(2)
    // Newest activity first: solo (10 июн) before the orig chain (5 июн)
    expect(chains[0].root.id).toBe('solo')
    expect(chains[1].versions.map((a) => a.id)).toEqual(['orig', 'rev2', 'rev3'])
  })

  it('treats a revision with a missing parent as its own chain root', () => {
    const orphan = make({ id: 'orphan', parent_assignment_id: 'gone', revision_number: 2 })
    const chains = buildChains([orphan])
    expect(chains).toHaveLength(1)
    expect(chains[0].root.id).toBe('orphan')
  })

  it('groups unlinked resubmissions by submission-text similarity (no explicit parent link)', () => {
    const first  = make({ id: 'first',  course_id: 'course-1', created_at: '2026-06-14T10:00:00Z', submission_text: SIMILAR_TEXT_A })
    const second = make({ id: 'second', course_id: 'course-1', created_at: '2026-06-22T10:00:00Z', submission_text: SIMILAR_TEXT_B })
    const unrelated = make({ id: 'other', course_id: 'course-1', created_at: '2026-06-18T10:00:00Z' })

    const chains = buildChains([first, second, unrelated])
    expect(chains).toHaveLength(2)
    const grouped = chains.find((c) => c.versions.length === 2)
    expect(grouped?.versions.map((a) => a.id)).toEqual(['first', 'second'])
  })

  it('does not group similar text across different courses', () => {
    const a = make({ id: 'a', course_id: 'course-1', submission_text: SIMILAR_TEXT_A })
    const b = make({ id: 'b', course_id: 'course-2', submission_text: SIMILAR_TEXT_B })
    const chains = buildChains([a, b])
    expect(chains).toHaveLength(2)
  })
})

describe('jaccardSimilarity / tokenize', () => {
  it('scores near-duplicate texts above the grouping threshold and unrelated ones below it', () => {
    const sim = jaccardSimilarity(tokenize(SIMILAR_TEXT_A), tokenize(SIMILAR_TEXT_B))
    expect(sim).toBeGreaterThanOrEqual(0.5)
    const low = jaccardSimilarity(tokenize(SIMILAR_TEXT_A), tokenize('совершенно другая тема про финансовую отчетность предприятия'))
    expect(low).toBeLessThan(0.5)
  })
})

describe('computeStudentStats', () => {
  it('counts first submissions vs resubmissions', () => {
    const a = make({ id: 'a' })
    const b = make({ id: 'b', parent_assignment_id: 'a', revision_number: 2, created_at: '2026-06-02T10:00:00Z' })
    const c = make({ id: 'c' })
    const stats = computeStudentStats([a, b, c])
    expect(stats.firstSubmissions).toBe(2)
    expect(stats.resubmissions).toBe(1)
    expect(stats.chainsWithRework).toBe(1)
    expect(stats.totalChains).toBe(2)
  })

  it('computes median rework gap in hours', () => {
    const a = make({ id: 'a', created_at: '2026-06-01T10:00:00Z' })
    const b = make({ id: 'b', parent_assignment_id: 'a', revision_number: 2, created_at: '2026-06-01T16:00:00Z' }) // 6h
    const c = make({ id: 'c', parent_assignment_id: 'b', revision_number: 3, created_at: '2026-06-02T16:00:00Z' }) // 24h
    const stats = computeStudentStats([a, b, c])
    expect(stats.medianReworkHours).toBe(15) // median of [6, 24]
  })

  it('averages first→last score delta, preferring approved scores', () => {
    const a = make({ id: 'a', ai_score: 55 })
    const b = make({
      id: 'b', parent_assignment_id: 'a', revision_number: 2,
      created_at: '2026-06-02T10:00:00Z', ai_score: 70, approved_score: 75,
    })
    const stats = computeStudentStats([a, b])
    expect(stats.avgScoreDelta).toBe(20) // 75 − 55
  })

  it('aggregates revision-check verdicts into a correction rate with half credit for partial', () => {
    const a = make({ id: 'a' })
    const b = make({
      id: 'b', parent_assignment_id: 'a', revision_number: 2,
      created_at: '2026-06-02T10:00:00Z',
      ai_revision_check: check(['addressed', 'addressed', 'partial', 'not_addressed']),
    })
    const stats = computeStudentStats([a, b])
    expect(stats.corrections).toEqual({ addressed: 2, partial: 1, not_addressed: 1 })
    expect(stats.correctionRate).toBe(63) // (2 + 0.5) / 4 = 62.5 → 63
  })

  it('returns nulls when there are no resubmissions or revision checks', () => {
    const stats = computeStudentStats([make({ id: 'a' }), make({ id: 'b' })])
    expect(stats.medianReworkHours).toBeNull()
    expect(stats.avgScoreDelta).toBeNull()
    expect(stats.correctionRate).toBeNull()
  })
})

describe('formatHours', () => {
  it('formats minutes, hours, and days', () => {
    expect(formatHours(0.5)).toBe('30 мин')
    expect(formatHours(6)).toBe('6 ч')
    expect(formatHours(30)).toBe('30 ч')
    expect(formatHours(72)).toBe('3 дн.')
  })
})
