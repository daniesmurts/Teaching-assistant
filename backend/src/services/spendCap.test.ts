import { describe, it, expect } from 'vitest'
import { pickEffectiveCap } from './spendCap'
import { PLAN_LIMITS } from '../config/planLimits'

describe('pickEffectiveCap', () => {
  it('uses the explicit override when present, regardless of tier', () => {
    expect(pickEffectiveCap(500, 'free')).toBe(500)
    expect(pickEffectiveCap(0, 'institution')).toBe(0)
  })

  it('falls back to the tier default when no override is set', () => {
    expect(pickEffectiveCap(null, 'free')).toBe(PLAN_LIMITS.free.monthlySpendCapUsd)
    expect(pickEffectiveCap(null, 'pro')).toBe(PLAN_LIMITS.pro.monthlySpendCapUsd)
    expect(pickEffectiveCap(null, 'institution')).toBe(PLAN_LIMITS.institution.monthlySpendCapUsd)
  })

  it('falls back to the free default for an unrecognised tier', () => {
    expect(pickEffectiveCap(null, 'nonsense')).toBe(PLAN_LIMITS.free.monthlySpendCapUsd)
  })
})
