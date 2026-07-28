import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { pool } from '../db/connection'
import { authenticate } from './authenticate'
import { signToken } from '../lib/jwt'
import { SESSION_COOKIE_NAME } from '../lib/session'
import { createTestTeacher, createTestInstitution } from '../db/__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

function mockReqRes(token: string) {
  const req = {
    method:  'GET',
    headers: {},
    cookies: { [SESSION_COOKIE_NAME]: token },
  } as unknown as Request
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res = { status } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, status, json, next }
}

describe('authenticate middleware — DB-dependent paths', () => {
  it('populates req.teacher from a valid token against a real teacher row', async () => {
    const teacher = await createTestTeacher()
    const { token } = signToken({ id: teacher.id, email: teacher.email })
    const { req, next } = mockReqRes(token)

    await authenticate(req, {} as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.teacher.id).toBe(teacher.id)
    expect(req.teacher.plan_tier).toBe('free')
    expect(req.teacher.is_active).toBe(true)
  })

  it('rejects a deactivated account with 401 ACCOUNT_DISABLED', async () => {
    const teacher = await createTestTeacher()
    await pool.query('UPDATE teachers SET is_active = FALSE WHERE id = $1', [teacher.id])
    const { token } = signToken({ id: teacher.id, email: teacher.email })
    const { req, res, status, json, next } = mockReqRes(token)

    await authenticate(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'ACCOUNT_DISABLED' }))
  })

  it('inherits the institution tier when it is stronger than the teacher\'s own (expired) plan', async () => {
    const institution = await createTestInstitution({ planTier: 'institution' })
    const teacher = await createTestTeacher({ institutionId: institution.id })
    // Own plan expired in the past — computeEffectiveTier should fall back to
    // 'free' for the personal plan, then the institution join lifts it back up.
    await pool.query(
      `UPDATE teachers SET plan_tier = 'pro', plan_expires_at = NOW() - INTERVAL '1 day' WHERE id = $1`,
      [teacher.id]
    )
    const { token } = signToken({ id: teacher.id, email: teacher.email })
    const { req, next } = mockReqRes(token)

    await authenticate(req, {} as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(req.teacher.plan_tier).toBe('institution')
  })

  it('rejects a token issued before the account\'s password was changed', async () => {
    const teacher = await createTestTeacher()
    const { token } = signToken({ id: teacher.id, email: teacher.email })
    // Simulate a password change happening AFTER the token was issued.
    await pool.query(`UPDATE teachers SET password_changed_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [teacher.id])
    const { req, res, status, json, next } = mockReqRes(token)

    await authenticate(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(401)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }))
  })
})
