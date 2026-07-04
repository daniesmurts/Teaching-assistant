import { describe, it, expect } from 'vitest'
import { rollUp, selectRelevantSections } from './documentReview'
import type { DisciplineCoverageIndicator, CoverageStatus } from '../../../shared/types'

// Roll-up: a competency's coverage is the sum of its индикаторы достижения
// (ФГОС 3++). all covered → covered; all missing → missing; else partial.
const ind = (status: CoverageStatus): DisciplineCoverageIndicator =>
  ({ code: null, title: 'x', dimension: null, status, evidence: null, note: '' })

describe('rollUp', () => {
  it('all covered → covered', () => {
    expect(rollUp([ind('covered'), ind('covered')])).toBe('covered')
  })
  it('all missing → missing', () => {
    expect(rollUp([ind('missing'), ind('missing')])).toBe('missing')
  })
  it('mixed covered + missing → partial', () => {
    expect(rollUp([ind('covered'), ind('missing')])).toBe('partial')
  })
  it('any partial present → partial', () => {
    expect(rollUp([ind('covered'), ind('partial')])).toBe('partial')
    expect(rollUp([ind('partial')])).toBe('partial')
  })
  it('single covered → covered; single missing → missing', () => {
    expect(rollUp([ind('covered')])).toBe('covered')
    expect(rollUp([ind('missing')])).toBe('missing')
  })
  it('empty → missing (nothing declared/covered)', () => {
    expect(rollUp([])).toBe('missing')
  })
})

// Section-aware slicing: the coverage scorer needs the content sections that
// live in the middle-to-end of a real РПД (лекции / практ / лаб / СРС / ФОС),
// not a blind head-slice. Under budget we return the text intact; over budget
// we prefer the content/assessment sections; and when we can't find headings
// we fall back to head+tail so the tail isn't silently lost.
describe('selectRelevantSections', () => {
  const bulk = (label: string, size: number) => `${label}\n${'x '.repeat(Math.floor(size / 2))}`

  it('returns the whole text when it fits the budget', () => {
    const t = 'РПД короткая'
    expect(selectRelevantSections(t, 1000)).toBe(t)
  })

  it('prefers content sections (лекции / практ / ФОС) over the intro when over budget', () => {
    const intro    = bulk('1. Введение', 2000)
    const lectures = bulk('5. Содержание разделов дисциплины', 2000)
    const fos      = bulk('8. Фонд оценочных средств', 2000)
    const doc = [intro, lectures, fos].join('\n')
    const out = selectRelevantSections(doc, 3500)
    // Content sections are picked; the intro chunk is dropped.
    expect(out).toContain('Содержание разделов дисциплины')
    expect(out).toContain('Фонд оценочных средств')
    expect(out).not.toContain('Введение')
  })

  it('falls back to head+tail when no headings match', () => {
    const doc = 'A'.repeat(20000) + 'MIDDLE' + 'B'.repeat(20000)
    const out = selectRelevantSections(doc, 4000)
    // No section anchors → we get the head AND the tail (not just the head).
    expect(out.startsWith('A')).toBe(true)
    expect(out.endsWith('B')).toBe(true)
    expect(out).toContain('[...]')
  })

  it('includes the ФОС section even if it sits deep in a long document', () => {
    const head = bulk('Раздел 1', 30000)
    const fos  = bulk('7. Фонд оценочных средств', 500)
    const doc = `${head}\n${fos}`
    const out = selectRelevantSections(doc, 8000)
    expect(out).toContain('Фонд оценочных средств')
  })
})
