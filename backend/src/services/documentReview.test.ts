import { describe, it, expect } from 'vitest'
import { rollUp } from './documentReview'
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
