import { describe, it, expect } from 'vitest'
import {
  fitIsotonicCalibration, applyCalibration, validateCalibrationSplit,
  type CalibrationPair, type TimestampedCalibrationPair,
} from './scoreCalibration'

function pairs(n: number, fn: (i: number) => CalibrationPair): CalibrationPair[] {
  return Array.from({ length: n }, (_, i) => fn(i))
}

function timestampedPairs(n: number, fn: (i: number) => CalibrationPair): TimestampedCalibrationPair[] {
  return Array.from({ length: n }, (_, i) => ({ ...fn(i), createdAt: i }))
}

describe('fitIsotonicCalibration', () => {
  it('returns null below the minimum sample size', () => {
    const data = pairs(10, (i) => ({ aiScore: i * 10, teacherScore: i * 10 }))
    expect(fitIsotonicCalibration(data, 20)).toBeNull()
  })

  it('fits a near-identity map when AI and teacher scores already agree', () => {
    const data = pairs(30, (i) => ({ aiScore: i * 3, teacherScore: i * 3 }))
    const points = fitIsotonicCalibration(data, 20)!
    expect(points).not.toBeNull()
    for (const p of points) expect(p.y).toBeCloseTo(p.x, 1)
  })

  it('corrects a systematic positive bias (AI grades consistently high)', () => {
    // AI always scores 10 points hotter than the teacher's final score.
    const data = pairs(30, (i) => ({ aiScore: 40 + i * 2, teacherScore: 30 + i * 2 }))
    const points = fitIsotonicCalibration(data, 20)!
    for (const p of points) expect(p.y).toBeCloseTo(p.x - 10, 1)
  })

  it('produces a monotone non-decreasing map even from noisy/reversed local data', () => {
    // A local reversal at i=15 (score dips) that PAVA must pool away.
    const data = pairs(30, (i) => ({
      aiScore: i * 3,
      teacherScore: i === 15 ? 0 : i * 3,
    }))
    const points = fitIsotonicCalibration(data, 20)!
    for (let i = 1; i < points.length; i++) {
      expect(points[i].y).toBeGreaterThanOrEqual(points[i - 1].y)
      expect(points[i].x).toBeGreaterThan(points[i - 1].x)
    }
  })

  it('returns null when a fully-reversed relationship pools into one block', () => {
    // Teacher score strictly decreases as AI score increases — PAVA pools
    // the entire sequence into a single block, leaving no usable shape.
    const reversed = pairs(25, (i) => ({ aiScore: i * 4, teacherScore: 100 - i * 4 }))
    expect(fitIsotonicCalibration(reversed, 20)).toBeNull()
  })
})

describe('applyCalibration', () => {
  it('passes the raw score through unchanged when there is no map', () => {
    expect(applyCalibration(73, null)).toBe(73)
    expect(applyCalibration(73, [{ x: 50, y: 50 }])).toBe(73) // single point — not enough to interpolate
  })

  it('interpolates linearly between two breakpoints', () => {
    const points = [{ x: 0, y: 10 }, { x: 100, y: 90 }]
    expect(applyCalibration(50, points)).toBe(50)   // midpoint: 10 + 0.5*(90-10) = 50
    expect(applyCalibration(0, points)).toBe(10)
    expect(applyCalibration(100, points)).toBe(90)
  })

  it('extrapolates flat beyond the fitted domain', () => {
    const points = [{ x: 20, y: 30 }, { x: 80, y: 70 }]
    expect(applyCalibration(0, points)).toBe(30)
    expect(applyCalibration(100, points)).toBe(70)
  })

  it('clamps the result to 0–100', () => {
    const points = [{ x: 0, y: -5 }, { x: 100, y: 105 }]
    expect(applyCalibration(0, points)).toBe(0)
    expect(applyCalibration(100, points)).toBe(100)
  })
})

describe('validateCalibrationSplit', () => {
  // Score value decorrelated from time order (via a coprime-modulus spread)
  // so both the earlier (train) and later (test) chronological slices sample
  // roughly the same score range — isolates the "does it generalise" question
  // from flat-extrapolation effects at the edge of the fitted domain.
  function spreadAiScore(i: number): number {
    return 20 + ((i * 37) % 71)   // range 20..90, well spread, deterministic
  }

  it('returns null when the train slice is too small', () => {
    const data = timestampedPairs(10, (i) => ({ aiScore: spreadAiScore(i), teacherScore: spreadAiScore(i) }))
    expect(validateCalibrationSplit(data)).toBeNull()
  })

  it('returns null when the held-out test slice is too small', () => {
    // 30 pairs is enough for the default train minimum (20), but a 0.95
    // split leaves only 2 in test — below the default minTest of 5.
    const data = timestampedPairs(30, (i) => ({ aiScore: spreadAiScore(i), teacherScore: spreadAiScore(i) }))
    expect(validateCalibrationSplit(data, { trainFraction: 0.95 })).toBeNull()
  })

  it('proves the map generalises to held-out (chronologically later) data: fixes a bias it never saw', () => {
    // A systematic +15 AI bias runs across the WHOLE timeline. The fit only
    // ever sees the train slice (i < 65); the test slice (i >= 65) is scored
    // using a map that never touched those specific rows — if calibrated
    // error collapses on test too, that's genuine generalisation, not
    // memorisation of the evaluation set.
    const data = timestampedPairs(100, (i) => {
      const ai = spreadAiScore(i)
      return { aiScore: ai, teacherScore: ai - 15 }
    })
    const result = validateCalibrationSplit(data, { trainFraction: 0.65 })!
    expect(result).not.toBeNull()
    expect(result.nTrain).toBe(65)
    expect(result.nTest).toBe(35)
    // Baseline (raw AI score vs teacher score) carries the full +15 bias.
    expect(result.baseline.mae).toBeCloseTo(15, 0)
    // Calibrated error on the SAME held-out rows collapses close to zero —
    // the correction learned on train transfers to test.
    expect(result.calibrated.mae).toBeLessThan(2)
    expect(result.maeImprovementPct).toBeGreaterThan(85)
  })

  it('reports near-zero improvement when the AI score is already well calibrated', () => {
    const data = timestampedPairs(100, (i) => {
      const ai = spreadAiScore(i)
      return { aiScore: ai, teacherScore: ai }   // no bias to correct
    })
    const result = validateCalibrationSplit(data, { trainFraction: 0.65 })!
    expect(result).not.toBeNull()
    expect(result.baseline.mae).toBeCloseTo(0, 0)
    expect(result.calibrated.mae).toBeCloseTo(0, 0)
  })

  it('reports rho as null when the held-out slice has fewer than 2 pairs', () => {
    const data = timestampedPairs(93, (i) => ({ aiScore: spreadAiScore(i), teacherScore: spreadAiScore(i) - 15 }))
    const result = validateCalibrationSplit(data, { trainFraction: 0.99, minTest: 1 })!
    expect(result).not.toBeNull()
    expect(result.nTest).toBe(1)
    expect(result.baseline.rho).toBeNull()
    expect(result.calibrated.rho).toBeNull()
  })
})
