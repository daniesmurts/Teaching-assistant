import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  computeTierDistribution, computeFreeOutliers, computeBreaksAtTeachers, projectAtScenario,
  getMonthlyInfraCostUsd, FREE_COST_THRESHOLDS_USD,
} from './capacityModel'
import type { UsageRollupRow } from '../db/queries/usageRollup'

function row(overrides: Partial<UsageRollupRow> = {}): UsageRollupRow {
  return {
    month: '2026-07', teacher_id: 't', institution_id: null, effective_tier: 'free',
    call_count: 1, total_tokens: 100, cost_usd: 0,
    amortized_revenue_rub: null, amortized_revenue_usd: null,
    ...overrides,
  }
}

describe('computeTierDistribution', () => {
  it('groups by effective_tier and computes n/mean/p50/p95/max independently per tier', () => {
    const rows = [
      row({ effective_tier: 'free', cost_usd: 1 }),
      row({ effective_tier: 'free', cost_usd: 3 }),
      row({ effective_tier: 'pro', cost_usd: 10 }),
    ]
    const dist = computeTierDistribution(rows)
    const free = dist.find((d) => d.tier === 'free')!
    const pro  = dist.find((d) => d.tier === 'pro')!
    expect(free.n).toBe(2)
    expect(free.mean).toBe(2)
    expect(pro.n).toBe(1)
    expect(pro.mean).toBe(10)
  })

  it('returns an empty array for no rows, not a divide-by-zero row', () => {
    expect(computeTierDistribution([])).toEqual([])
  })

  it('sorts tiers alphabetically for a stable render order', () => {
    const rows = [row({ effective_tier: 'pro' }), row({ effective_tier: 'free' }), row({ effective_tier: 'institution' })]
    const dist = computeTierDistribution(rows)
    expect(dist.map((d) => d.tier)).toEqual(['free', 'institution', 'pro'])
  })
})

describe('computeFreeOutliers', () => {
  it('counts free-tier teachers above each threshold, ignoring other tiers', () => {
    const rows = [
      row({ effective_tier: 'free', cost_usd: 0.5 }),
      row({ effective_tier: 'free', cost_usd: 2 }),
      row({ effective_tier: 'free', cost_usd: 6 }),
      row({ effective_tier: 'pro', cost_usd: 100 }),   // must not count toward free outliers
    ]
    const outliers = computeFreeOutliers(rows)
    expect(outliers).toHaveLength(FREE_COST_THRESHOLDS_USD.length)
    const at1 = outliers.find((o) => o.thresholdUsd === 1)!
    const at5 = outliers.find((o) => o.thresholdUsd === 5)!
    expect(at1.count).toBe(2)   // 2 and 6 exceed $1
    expect(at1.total).toBe(3)   // 3 free teachers total
    expect(at5.count).toBe(1)   // only 6 exceeds $5
  })
})

describe('computeBreaksAtTeachers', () => {
  it('projects linearly: at 2x current teachers, a resource at 50% of ceiling breaks', () => {
    // current=25 at 10 teachers → 2.5/teacher; ceiling=50 → breaks at 20 teachers
    expect(computeBreaksAtTeachers(25, 50, 10)).toBe(20)
  })

  it('returns null when there is no ceiling to compare against', () => {
    expect(computeBreaksAtTeachers(25, null, 10)).toBeNull()
  })

  it('returns null when there are no active teachers to derive a coefficient from', () => {
    expect(computeBreaksAtTeachers(25, 50, 0)).toBeNull()
  })

  it('returns null when current usage is zero — no coefficient, not "never breaks"', () => {
    expect(computeBreaksAtTeachers(0, 50, 10)).toBeNull()
  })
})

describe('projectAtScenario', () => {
  it('scales current usage proportionally to the scenario teacher count', () => {
    expect(projectAtScenario(100, 10, 30)).toBe(300)
  })

  it('returns null when there are no active teachers today to derive a rate from', () => {
    expect(projectAtScenario(100, 0, 30)).toBeNull()
  })
})

describe('getMonthlyInfraCostUsd', () => {
  const KEY = 'MONTHLY_INFRA_COST_USD'
  let saved: string | undefined
  beforeEach(() => { saved = process.env[KEY]; delete process.env[KEY] })
  afterEach(() => { if (saved === undefined) delete process.env[KEY]; else process.env[KEY] = saved })

  it('is null (not a guessed number) when unset', () => {
    expect(getMonthlyInfraCostUsd()).toBeNull()
  })

  it('reads a valid positive override', () => {
    process.env[KEY] = '120'
    expect(getMonthlyInfraCostUsd()).toBe(120)
  })

  it('falls back to null for an invalid or non-positive value', () => {
    process.env[KEY] = 'not-a-number'
    expect(getMonthlyInfraCostUsd()).toBeNull()
    process.env[KEY] = '-5'
    expect(getMonthlyInfraCostUsd()).toBeNull()
  })
})
