import { describe, it, expect } from 'vitest'
import {
  emailVerifyToken, verifyEmailVerifyToken, extractTeacherIdFromVerifyToken,
} from './emailVerification'

// Pure — the HMAC token needs no DB. Signing secret comes from the unit-test
// env's JWT_SECRET (same source as jwt.test.ts / activation.test.ts).

const ID    = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const EMAIL = 'teacher@example.ru'

describe('email verification token', () => {
  it('round-trips a teacher id when the email matches', () => {
    expect(verifyEmailVerifyToken(emailVerifyToken(ID, EMAIL), EMAIL)).toBe(ID)
  })

  it('is case-insensitive on the email', () => {
    expect(verifyEmailVerifyToken(emailVerifyToken(ID, 'Teacher@Example.RU'), EMAIL)).toBe(ID)
  })

  it('rejects when the account email has since changed', () => {
    const token = emailVerifyToken(ID, EMAIL)
    expect(verifyEmailVerifyToken(token, 'new-address@example.ru')).toBeNull()
  })

  it('rejects a tampered signature', () => {
    const token = emailVerifyToken(ID, EMAIL)
    expect(verifyEmailVerifyToken(token.slice(0, -4) + 'beef', EMAIL)).toBeNull()
  })

  it('rejects a token re-targeted at a different teacher id', () => {
    const sig = emailVerifyToken(ID, EMAIL).split('.').pop()!
    expect(verifyEmailVerifyToken(`ffffffff-0000-1111-2222-333333333333.${sig}`, EMAIL)).toBeNull()
  })

  it('rejects malformed tokens', () => {
    expect(verifyEmailVerifyToken('', EMAIL)).toBeNull()
    expect(verifyEmailVerifyToken('no-dot-here', EMAIL)).toBeNull()
    expect(verifyEmailVerifyToken('.only-sig', EMAIL)).toBeNull()
  })

  it('extracts the claimed teacher id without authenticating it', () => {
    expect(extractTeacherIdFromVerifyToken(emailVerifyToken(ID, EMAIL))).toBe(ID)
    expect(extractTeacherIdFromVerifyToken('no-dot-here')).toBeNull()
    expect(extractTeacherIdFromVerifyToken('.only-sig')).toBeNull()
  })

  it('is not interchangeable with the nudge/marketing token namespaces', async () => {
    const { verifyNudgeUnsubToken } = await import('./activation')
    const { verifyMarketingUnsubToken } = await import('./marketingEmails')
    const token = emailVerifyToken(ID, EMAIL)
    expect(verifyNudgeUnsubToken(token)).toBeNull()
    expect(verifyMarketingUnsubToken(token)).toBeNull()
  })
})
