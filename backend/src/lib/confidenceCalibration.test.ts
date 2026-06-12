import { describe, it, expect } from 'vitest'
import {
  riskCoverageCurve, binnedCalibration, selectivityGain, fitThresholds, type ConfidencePair,
} from './confidenceCalibration'

// Synthetic data where error rises with the signal — i.e. the confidence
// estimator is informative. signal 0..9, error tracks it.
function informativePairs(): ConfidencePair[] {
  return Array.from({ length: 10 }, (_, i) => ({
    signal:     i,
    scoreError: i * 2,            // 0,2,4,...18
    gradeMatch: i < 5,           // the confident half matches
  }))
}

describe('riskCoverageCurve', () => {
  it('returns empty for no data', () => {
    expect(riskCoverageCurve([])).toEqual([])
  })

  it('keeps the most-confident subset at each coverage level', () => {
    const curve = riskCoverageCurve(informativePairs(), [1.0, 0.5])
    const full = curve.find((c) => c.coverage === 1.0)!
    const half = curve.find((c) => c.coverage === 0.5)!
    expect(full.n).toBe(10)
    expect(half.n).toBe(5)
    // Full mean error = mean(0..18) = 9; confident half = mean(0,2,4,6,8) = 4
    expect(full.meanError).toBeCloseTo(9, 5)
    expect(half.meanError).toBeCloseTo(4, 5)
  })

  it('produces monotonically decreasing risk as coverage shrinks (informative signal)', () => {
    const curve = riskCoverageCurve(informativePairs())
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i].meanError).toBeLessThanOrEqual(curve[i - 1].meanError)
    }
  })

  it('improves grade accuracy on the confident subset', () => {
    const curve = riskCoverageCurve(informativePairs(), [1.0, 0.5])
    const full = curve.find((c) => c.coverage === 1.0)!
    const half = curve.find((c) => c.coverage === 0.5)!
    expect(full.gradeAccuracy).toBeCloseTo(0.5, 5)   // 5/10
    expect(half.gradeAccuracy).toBeCloseTo(1.0, 5)   // all 5 confident ones match
  })

  it('reports the dispersion threshold at each coverage', () => {
    const curve = riskCoverageCurve(informativePairs(), [0.5])
    expect(curve[0].signalMax).toBe(4)   // 5th most-confident has signal 4
  })

  it('is flat for a non-informative signal (error unrelated to confidence)', () => {
    const flat: ConfidencePair[] = Array.from({ length: 8 }, (_, i) => ({
      signal: i, scoreError: 5, gradeMatch: true,
    }))
    const curve = riskCoverageCurve(flat, [1.0, 0.5, 0.25])
    expect(curve.every((c) => c.meanError === 5)).toBe(true)
  })
})

describe('binnedCalibration', () => {
  it('orders bins by ascending signal with rising error', () => {
    const bins = binnedCalibration(informativePairs(), 3)
    expect(bins.length).toBe(3)
    expect(bins[0].meanError).toBeLessThan(bins[2].meanError)
    expect(bins[0].signalLow).toBe(0)
    expect(bins[2].signalHigh).toBe(9)
  })

  it('returns empty for no data', () => {
    expect(binnedCalibration([])).toEqual([])
  })
})

describe('selectivityGain', () => {
  it('is positive and large when the signal separates good from bad', () => {
    const gain = selectivityGain(informativePairs())
    expect(gain).toBeGreaterThan(0)
  })

  it('is ~0 when error is constant regardless of confidence', () => {
    const flat: ConfidencePair[] = Array.from({ length: 9 }, (_, i) => ({
      signal: i, scoreError: 7, gradeMatch: true,
    }))
    expect(selectivityGain(flat)).toBe(0)
  })
})

describe('fitThresholds', () => {
  it('returns null on too little data', () => {
    expect(fitThresholds([{ signal: 1, scoreError: 2, gradeMatch: true }])).toBeNull()
  })

  it('places highStdMax over the low-error head and lowStdMin over the high-error tail', () => {
    // std 0..9, error tracks std: confident head is accurate, tail is bad.
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      signal: i, scoreError: i * 2, gradeMatch: i < 4,
    }))
    const fit = fitThresholds(pairs, { highTargetError: 6, lowTargetError: 12 })!
    expect(fit).not.toBeNull()
    // head: errors 0,2,4,6 → means stay ≤6 through signal 3 (mean 3); signal 4 (err 8) → running mean 4 still ≤6...
    expect(fit.highStdMax).toBeGreaterThanOrEqual(3)
    // tail: errors 18,16,14,12 average ≥12 down to signal 6
    expect(fit.lowStdMin).toBeLessThanOrEqual(9)
    expect(fit.lowStdMin).toBeGreaterThan(fit.highStdMax)
  })

  it('keeps the high/low bands ordered even on adversarial data', () => {
    const pairs = Array.from({ length: 8 }, (_, i) => ({
      signal: i, scoreError: 20, gradeMatch: false,   // everything is bad
    }))
    const fit = fitThresholds(pairs)!
    expect(fit.lowStdMin).toBeGreaterThan(fit.highStdMax)
    expect(fit.nHigh).toBe(0)   // nothing qualifies as high
  })

  it('reports the resulting subset errors', () => {
    const pairs = Array.from({ length: 10 }, (_, i) => ({
      signal: i, scoreError: i, gradeMatch: true,
    }))
    const fit = fitThresholds(pairs, { highTargetError: 3, lowTargetError: 7 })!
    expect(fit.highError).toBeLessThanOrEqual(3)
    expect(fit.lowError).toBeGreaterThanOrEqual(7)
  })
})
