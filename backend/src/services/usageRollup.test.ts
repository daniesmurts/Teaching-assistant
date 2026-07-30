import { describe, it, expect } from 'vitest'
import { amortizedRevenueForMonthRub, isOverheadFeature, percentile, OVERHEAD_FEATURES, monthsToRefresh } from './usageRollup'

describe('isOverheadFeature', () => {
  it('classifies rpd_reminder as overhead', () => {
    expect(isOverheadFeature('rpd_reminder')).toBe(true)
  })

  it('classifies grading, presentation, embedding etc. as teacher-attributable', () => {
    expect(isOverheadFeature('grading')).toBe(false)
    expect(isOverheadFeature('presentation')).toBe(false)
    expect(isOverheadFeature('embedding')).toBe(false)
  })

  it('is driven by the exported OVERHEAD_FEATURES list, not a hardcoded switch', () => {
    expect(OVERHEAD_FEATURES).toContain('rpd_reminder')
  })
})

describe('amortizedRevenueForMonthRub', () => {
  it('attributes the full pro_monthly amount only to the month it was confirmed in', () => {
    const payment = { plan: 'pro_monthly', amount_kopecks: 50000, confirmed_at: '2026-03-15T10:00:00Z' }
    expect(amortizedRevenueForMonthRub(payment, '2026-03')).toBe(500)
    expect(amortizedRevenueForMonthRub(payment, '2026-04')).toBe(0)
    expect(amortizedRevenueForMonthRub(payment, '2026-02')).toBe(0)
  })

  it('spreads a pro_annual payment across exactly 12 months starting at the confirmed month', () => {
    const payment = { plan: 'pro_annual', amount_kopecks: 1_200_000, confirmed_at: '2026-01-10T10:00:00Z' }
    // 12,000 ₽ / 12 = 1,000 ₽/month
    expect(amortizedRevenueForMonthRub(payment, '2026-01')).toBe(1000)   // confirmed month itself
    expect(amortizedRevenueForMonthRub(payment, '2026-06')).toBe(1000)   // mid-window
    expect(amortizedRevenueForMonthRub(payment, '2026-12')).toBe(1000)   // last month in window (offset 11)
    expect(amortizedRevenueForMonthRub(payment, '2027-01')).toBe(0)      // one month past the window
    expect(amortizedRevenueForMonthRub(payment, '2025-12')).toBe(0)      // one month before confirmation
  })

  it('does not produce the fake January spike a naive sum-by-confirmed-month would', () => {
    // A single annual payment confirmed in January must NOT show its full
    // value in January and zero everywhere else — that's the exact bug
    // TODO.md calls out.
    const payment = { plan: 'pro_annual', amount_kopecks: 1_200_000, confirmed_at: '2026-01-10T10:00:00Z' }
    const january = amortizedRevenueForMonthRub(payment, '2026-01')
    const february = amortizedRevenueForMonthRub(payment, '2026-02')
    expect(january).toBe(february)
  })

  it('returns 0 for an unrecognised plan value rather than throwing', () => {
    const payment = { plan: 'enterprise_custom', amount_kopecks: 100000, confirmed_at: '2026-01-01T00:00:00Z' }
    expect(amortizedRevenueForMonthRub(payment, '2026-01')).toBe(0)
  })
})

describe('monthsToRefresh', () => {
  it('returns exactly the current and previous UTC month, in chronological order', () => {
    const now = new Date()
    const cur  = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const prevDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    const prev = `${prevDate.getUTCFullYear()}-${String(prevDate.getUTCMonth() + 1).padStart(2, '0')}`
    expect(monthsToRefresh()).toEqual([prev, cur])
  })
})

describe('percentile', () => {
  it('returns 0 for an empty array without dividing by zero', () => {
    expect(percentile([], 0.95)).toBe(0)
  })

  it('returns the single value for a one-element array at any percentile', () => {
    expect(percentile([42], 0.5)).toBe(42)
    expect(percentile([42], 0.95)).toBe(42)
  })

  it('computes p50 and p95 on a sorted distribution using nearest-rank', () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1)   // 1..100
    expect(percentile(values, 0.5)).toBe(51)
    expect(percentile(values, 0.95)).toBe(96)
    expect(percentile(values, 1)).toBe(100)   // clamped to the last element, not out of bounds
  })
})
