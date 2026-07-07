import { describe, it, expect } from 'vitest'
import jwt from 'jsonwebtoken'
import { signToken, verifyToken } from './jwt'

// Pure — no DB needed. Lives alongside the other pure-function tests
// (vitest.config.ts), not the integration suite; the DB-dependent part of
// auth (the `authenticate` middleware's full flow) is tested separately in
// middleware/authenticate.integration.test.ts.

describe('signToken / verifyToken', () => {
  it('round-trips id and email through a valid token', () => {
    const token = signToken({ id: 'teacher-1', email: 'test@example.test' })
    const payload = verifyToken(token)
    expect(payload.id).toBe('teacher-1')
    expect(payload.email).toBe('test@example.test')
  })

  it('throws the expired-session message for an expired token', () => {
    // signToken() hardcodes a 7d expiry — build a custom-expiry token with
    // the same secret/algorithm/issuer to exercise the expired path directly.
    const token = jwt.sign({ id: 'teacher-1', email: 'test@example.test' }, process.env.JWT_SECRET!, {
      expiresIn: '-1s', algorithm: 'HS256', issuer: 'gradeassist',
    })
    expect(() => verifyToken(token)).toThrowError('Сессия истекла')
  })

  it('throws the invalid-session message for a tampered signature', () => {
    const token = signToken({ id: 'teacher-1', email: 'test@example.test' })
    const tampered = token.slice(0, -4) + 'abcd'
    expect(() => verifyToken(tampered)).toThrowError('Недействительная сессия')
  })

  it('throws the invalid-session message for a malformed token', () => {
    expect(() => verifyToken('not-a-jwt-at-all')).toThrowError('Недействительная сессия')
  })

  it('throws for a token signed with a different secret', () => {
    const token = jwt.sign({ id: 'teacher-1', email: 'test@example.test' }, 'wrong-secret', {
      expiresIn: '7d', algorithm: 'HS256', issuer: 'gradeassist',
    })
    expect(() => verifyToken(token)).toThrowError('Недействительная сессия')
  })
})
