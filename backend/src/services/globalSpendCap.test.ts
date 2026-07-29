import { describe, it, expect } from 'vitest'
import { parseDailyCapUsd } from './globalSpendCap'

describe('parseDailyCapUsd', () => {
  it('disables the breaker (Infinity) when unset', () => {
    expect(parseDailyCapUsd(undefined)).toBe(Infinity)
    expect(parseDailyCapUsd('')).toBe(Infinity)
  })

  it('parses a positive numeric override', () => {
    expect(parseDailyCapUsd('250')).toBe(250)
    expect(parseDailyCapUsd('12.5')).toBe(12.5)
  })

  it('falls back to Infinity for non-numeric or non-positive values', () => {
    expect(parseDailyCapUsd('not-a-number')).toBe(Infinity)
    expect(parseDailyCapUsd('0')).toBe(Infinity)
    expect(parseDailyCapUsd('-5')).toBe(Infinity)
  })
})
