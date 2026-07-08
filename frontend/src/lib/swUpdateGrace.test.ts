import { describe, it, expect } from 'vitest'
import { isUpdateStale, SW_UPDATE_GRACE_MS } from './swUpdateGrace'

describe('isUpdateStale', () => {
  const now = 1_700_000_000_000

  it('is not stale the moment an update is first seen', () => {
    expect(isUpdateStale(now, now)).toBe(false)
  })

  it('is not stale just under the grace period', () => {
    expect(isUpdateStale(now - (SW_UPDATE_GRACE_MS - 1000), now)).toBe(false)
  })

  it('is stale just over the grace period', () => {
    expect(isUpdateStale(now - (SW_UPDATE_GRACE_MS + 1000), now)).toBe(true)
  })

  it('is stale well past the grace period (e.g. a tab left open for a week)', () => {
    expect(isUpdateStale(now - 7 * 24 * 60 * 60 * 1000, now)).toBe(true)
  })
})
