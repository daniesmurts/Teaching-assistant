import { describe, it, expect } from 'vitest'
import { computePeakToMeanRatio, computeRateLimitKnee, computeAccountCeiling } from './providerCeilings'
import type { AccountSummary } from '../db/queries/providerCeilings'

describe('computePeakToMeanRatio', () => {
  it('divides peak hourly volume by the mean across the WHOLE window, including silent hours', () => {
    // 30 days = 720 hours. 720 total calls spread evenly would mean 1/hour,
    // but they're all concentrated in one peak hour of 100.
    const ratio = computePeakToMeanRatio(720, 100, 30)
    // mean = 720 / 720 = 1/hour; ratio = 100 / 1 = 100
    expect(ratio).toBe(100)
  })

  it('returns a ratio of 1 for perfectly uniform load', () => {
    // 720 hours, 720 total calls, peak hour also has exactly 1 call (uniform).
    expect(computePeakToMeanRatio(720, 1, 30)).toBe(1)
  })

  it('returns null when there is no data to compute from', () => {
    expect(computePeakToMeanRatio(0, 0, 30)).toBeNull()
  })

  it('returns null for a zero or negative window', () => {
    expect(computePeakToMeanRatio(100, 10, 0)).toBeNull()
  })
})

describe('computeRateLimitKnee', () => {
  it('reports observed:false and no knee when no hour ever hit a 429', () => {
    const knee = computeRateLimitKnee([{ calls: 50, rateLimited: 0 }, { calls: 80, rateLimited: 0 }])
    expect(knee.observed).toBe(false)
    expect(knee.minHourlyVolumeWithRateLimit).toBeNull()
    expect(knee.maxHourlyVolumeWithoutRateLimit).toBe(80)
  })

  it('brackets the knee between the largest clean hour and the smallest rate-limited hour', () => {
    const knee = computeRateLimitKnee([
      { calls: 40, rateLimited: 0 },
      { calls: 60, rateLimited: 0 },
      { calls: 90, rateLimited: 3 },
      { calls: 120, rateLimited: 5 },
    ])
    expect(knee.observed).toBe(true)
    expect(knee.maxHourlyVolumeWithoutRateLimit).toBe(60)
    expect(knee.minHourlyVolumeWithRateLimit).toBe(90)
  })

  it('handles an empty bucket list without throwing', () => {
    const knee = computeRateLimitKnee([])
    expect(knee.observed).toBe(false)
    expect(knee.minHourlyVolumeWithRateLimit).toBeNull()
    expect(knee.maxHourlyVolumeWithoutRateLimit).toBeNull()
  })
})

function summary(overrides: Partial<AccountSummary> = {}): AccountSummary {
  return {
    account: 'primary', totalCostUsd: 0, callCount: 0,
    balanceFailures: 0, failureCount: 0, lastSuccessAt: null, lastFailureAt: null,
    ...overrides,
  }
}

describe('computeAccountCeiling', () => {
  it('computes burn rate as total cost divided by the window in days', () => {
    const ceiling = computeAccountCeiling(summary({ totalCostUsd: 30 }), 30)
    expect(ceiling.burnRatePerDayUsd).toBe(1)
  })

  it('flags possiblyUnhealthy when the most recent event was a failure, not a success', () => {
    const ceiling = computeAccountCeiling(summary({
      lastSuccessAt: '2026-07-01T00:00:00Z',
      lastFailureAt: '2026-07-02T00:00:00Z',
    }), 30)
    expect(ceiling.possiblyUnhealthy).toBe(true)
  })

  it('does not flag possiblyUnhealthy when the account recovered after its last failure', () => {
    const ceiling = computeAccountCeiling(summary({
      lastFailureAt: '2026-07-01T00:00:00Z',
      lastSuccessAt: '2026-07-02T00:00:00Z',
    }), 30)
    expect(ceiling.possiblyUnhealthy).toBe(false)
  })

  it('does not flag possiblyUnhealthy when there has never been a failure', () => {
    const ceiling = computeAccountCeiling(summary({ lastSuccessAt: '2026-07-01T00:00:00Z' }), 30)
    expect(ceiling.possiblyUnhealthy).toBe(false)
  })
})
