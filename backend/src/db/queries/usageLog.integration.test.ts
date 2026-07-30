import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { createUsageLog, getDailyUsage, getUsageByTeacher } from './usageLog'
import { createTestTeacher, createTestCourse, createTestAssignment } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function logGradingCall(teacherId: string): Promise<void> {
  await createUsageLog({
    teacherId, feature: 'grading', model: 'deepseek-chat',
    inputTokens: 100, outputTokens: 50, costUsd: 0.001, durationMs: 500, success: true,
  })
}

// grade_count must reflect real grading actions (one row per graded
// submission in `assignments`), not the number of LLM calls logged under the
// shared 'grading' cost-bucket tag — a single click can log several of those
// (critic pass, calc verification, citation check, confidence-ensemble
// samples), which used to make "Проверок" wildly overstate real activity.
describe('getDailyUsage — grade_count is real grading actions, not LLM-call count', () => {
  it('counts one assignment as one check even when several LLM calls were logged as grading', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await createTestAssignment(t.id, course.id)   // one real grading action

    // Simulate a single grade() click that internally fired 4 chatJSON calls
    // (main grade + critic + calc verification + citation check) — all
    // logged under feature: 'grading'.
    await logGradingCall(t.id)
    await logGradingCall(t.id)
    await logGradingCall(t.id)
    await logGradingCall(t.id)

    const [today] = await getDailyUsage(1)
    expect(today.grade_count).toBe(1)
  })

  it('still counts a real assignment on a day with zero logged LLM calls (e.g. a completed long review already billed elsewhere)', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await createTestAssignment(t.id, course.id)

    const [today] = await getDailyUsage(1)
    expect(today.grade_count).toBe(1)
    expect(today.total_tokens).toBe(0)
  })

  it('still counts logged tokens/cost on a day with LLM activity but no assignment yet', async () => {
    const t = await createTestTeacher()
    await logGradingCall(t.id)

    const [today] = await getDailyUsage(1)
    expect(today.grade_count).toBe(0)
    expect(today.total_tokens).toBeGreaterThan(0)
  })
})

describe('getUsageByTeacher — grade_count is real grading actions, not LLM-call count', () => {
  it('counts one assignment as one check even when several LLM calls were logged as grading', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await createTestAssignment(t.id, course.id)
    await logGradingCall(t.id)
    await logGradingCall(t.id)
    await logGradingCall(t.id)

    const rows = await getUsageByTeacher(50)
    const row = rows.find((r) => r.teacher_id === t.id)
    expect(row?.grade_count).toBe(1)
  })

  it('shows grade_count 0 for a teacher who spent on non-grading features only', async () => {
    const t = await createTestTeacher()
    await createUsageLog({
      teacherId: t.id, feature: 'presentation', model: 'deepseek-chat',
      inputTokens: 200, outputTokens: 100, costUsd: 0.002, durationMs: 500, success: true,
    })

    const rows = await getUsageByTeacher(50)
    const row = rows.find((r) => r.teacher_id === t.id)
    expect(row?.grade_count).toBe(0)
    expect(row?.cost_usd).toBeGreaterThan(0)
  })
})
