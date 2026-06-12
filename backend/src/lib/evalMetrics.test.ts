import { describe, it, expect } from 'vitest'
import { quadraticWeightedKappa, meanAbsoluteError, spearman } from './evalMetrics'

describe('quadraticWeightedKappa', () => {
  it('returns 1 for perfect agreement', () => {
    expect(quadraticWeightedKappa([5, 4, 3, 2], [5, 4, 3, 2])).toBe(1)
  })

  it('returns 1 when both raters use a single category', () => {
    expect(quadraticWeightedKappa([4, 4, 4], [4, 4, 4])).toBe(1)
  })

  it('is exactly zero when observed disagreement equals chance expectation', () => {
    // a/b fully crossed: every (a,b) cell occurs once → observed == expected.
    const a = [2, 2, 3, 3]
    const b = [2, 3, 2, 3]
    expect(quadraticWeightedKappa(a, b)).toBeCloseTo(0, 10)
  })

  it('penalises distant disagreements more than близкие (quadratic weighting)', () => {
    const truth = [2, 3, 4, 5, 2, 3, 4, 5]
    const off1  = [3, 4, 5, 4, 3, 2, 3, 4]   // off by one mostly
    const off3  = [5, 5, 2, 2, 5, 5, 2, 2]   // wild swings
    expect(quadraticWeightedKappa(truth, off1)).toBeGreaterThan(quadraticWeightedKappa(truth, off3))
  })

  it('throws on mismatched lengths', () => {
    expect(() => quadraticWeightedKappa([1, 2], [1])).toThrow()
    expect(() => quadraticWeightedKappa([], [])).toThrow()
  })
})

describe('meanAbsoluteError', () => {
  it('is 0 for identical sequences', () => {
    expect(meanAbsoluteError([80, 90], [80, 90])).toBe(0)
  })

  it('averages absolute deltas', () => {
    expect(meanAbsoluteError([80, 90, 70], [85, 80, 70])).toBeCloseTo((5 + 10 + 0) / 3)
  })

  it('throws on mismatched lengths', () => {
    expect(() => meanAbsoluteError([1], [])).toThrow()
  })
})

describe('spearman', () => {
  it('is 1 for any monotonically increasing mapping', () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1)
    expect(spearman([1, 2, 3, 4], [2, 50, 51, 1000])).toBeCloseTo(1)
  })

  it('is -1 for a reversed ranking', () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1)
  })

  it('handles ties via average ranks', () => {
    const r = spearman([1, 2, 2, 3], [10, 20, 20, 30])
    expect(r).toBeCloseTo(1)
  })

  it('returns 1 when both sequences are constant', () => {
    expect(spearman([5, 5, 5], [7, 7, 7])).toBe(1)
  })

  it('throws on sequences shorter than 2', () => {
    expect(() => spearman([1], [1])).toThrow()
  })
})
