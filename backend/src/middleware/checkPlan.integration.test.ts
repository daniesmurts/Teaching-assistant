import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { Request, Response, NextFunction } from 'express'
import { pool } from '../db/connection'
import { checkMonthlyLimit, checkFeatureAccess, checkResourceLimit } from './checkPlan'
import { incrementUsage } from '../db/queries/usageCounters'
import { createTestTeacher, createTestCourse } from '../db/__tests__/fixtures'
import type { AuthTeacher } from './authenticate'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

// Express middleware are just functions — no HTTP server needed to test
// their logic. This mock captures exactly what the middleware sends back.
function mockReqRes(teacher: AuthTeacher) {
  const req = { teacher } as unknown as Request
  const json = vi.fn()
  const status = vi.fn(() => ({ json }))
  const res = { status } as unknown as Response
  const next = vi.fn() as unknown as NextFunction
  return { req, res, status, json, next }
}

function fakeTeacher(overrides: Partial<AuthTeacher> & { id: string; plan_tier: string }): AuthTeacher {
  return {
    email: 'test@example.test', role: 'teacher', institution_id: null,
    is_active: true, primary_org_unit_id: null, is_platform_admin: false,
    ...overrides,
  }
}

describe('checkMonthlyLimit', () => {
  it('calls next() when under the limit', async () => {
    const teacher = await createTestTeacher()
    const { req, res, next } = mockReqRes(fakeTeacher({ id: teacher.id, plan_tier: 'free' }))
    await checkMonthlyLimit('gradesPerMonth')(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })

  it('rejects with the exact 403 payload shape at the free-tier limit boundary', async () => {
    const teacher = await createTestTeacher()
    for (let i = 0; i < 20; i++) await incrementUsage(teacher.id, 'grade')   // free limit = 20

    const { req, res, status, json, next } = mockReqRes(fakeTeacher({ id: teacher.id, plan_tier: 'free' }))
    await checkMonthlyLimit('gradesPerMonth')(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'PLAN_LIMIT_REACHED', feature: 'gradesPerMonth', limit: 20, used: 20, upgrade: true,
    }))
  })

  it('skips the counter lookup entirely for unlimited (pro) plans', async () => {
    const teacher = await createTestTeacher()
    for (let i = 0; i < 100; i++) await incrementUsage(teacher.id, 'grade')

    const { req, res, next } = mockReqRes(fakeTeacher({ id: teacher.id, plan_tier: 'pro' }))
    await checkMonthlyLimit('gradesPerMonth')(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('checkFeatureAccess', () => {
  it('rejects a free-tier teacher for a Pro+ feature', () => {
    const { req, res, status, json, next } = mockReqRes(fakeTeacher({ id: 'x', plan_tier: 'free' }))
    checkFeatureAccess('calcVerification')(req, res, next)
    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ code: 'FEATURE_NOT_IN_PLAN', feature: 'calcVerification' }))
  })

  it('allows a pro-tier teacher through', () => {
    const { req, res, next } = mockReqRes(fakeTeacher({ id: 'x', plan_tier: 'pro' }))
    checkFeatureAccess('calcVerification')(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('checkResourceLimit', () => {
  it('trips at the free-tier maxCourses boundary', async () => {
    const teacher = await createTestTeacher()
    for (let i = 0; i < 3; i++) await createTestCourse(teacher.id)   // free limit = 3

    const { req, res, status, json, next } = mockReqRes(fakeTeacher({ id: teacher.id, plan_tier: 'free' }))
    await checkResourceLimit('courses', 'maxCourses')(req, res, next)

    expect(next).not.toHaveBeenCalled()
    expect(status).toHaveBeenCalledWith(403)
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      code: 'RESOURCE_LIMIT_REACHED', resource: 'courses', limit: 3, current: 3,
    }))
  })

  it('allows creation below the limit', async () => {
    const teacher = await createTestTeacher()
    await createTestCourse(teacher.id)

    const { req, res, next } = mockReqRes(fakeTeacher({ id: teacher.id, plan_tier: 'free' }))
    await checkResourceLimit('courses', 'maxCourses')(req, res, next)
    expect(next).toHaveBeenCalledOnce()
  })
})
