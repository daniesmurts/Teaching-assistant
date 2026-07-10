import { describe, it, expect } from 'vitest'
import { nudgeUnsubToken, verifyNudgeUnsubToken } from './activation'

// Pure — the HMAC token needs no DB. Signing secret comes from the unit-test
// env's JWT_SECRET (same source as jwt.test.ts).

describe('nudge unsubscribe token', () => {
  it('round-trips a teacher id', () => {
    const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
    expect(verifyNudgeUnsubToken(nudgeUnsubToken(id))).toBe(id)
  })

  it('rejects a tampered signature', () => {
    const token = nudgeUnsubToken('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const tampered = token.slice(0, -4) + 'beef'
    expect(verifyNudgeUnsubToken(tampered)).toBeNull()
  })

  it('rejects a token signed for a different teacher id', () => {
    const tokenA = nudgeUnsubToken('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const sig = tokenA.slice(tokenA.lastIndexOf('.') + 1)
    expect(verifyNudgeUnsubToken(`ffffffff-0000-1111-2222-333333333333.${sig}`)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyNudgeUnsubToken('')).toBeNull()
    expect(verifyNudgeUnsubToken('no-dot-here')).toBeNull()
    expect(verifyNudgeUnsubToken('.only-sig')).toBeNull()
  })
})
