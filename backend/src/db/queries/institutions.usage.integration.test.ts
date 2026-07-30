import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getInstitutionDailyUsage } from './institutions'
import { createUsageLog } from './usageLog'
import { createTestTeacher, createTestInstitution, createTestCourse, createTestAssignment } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

// Mirrors usageLog.integration.test.ts's getDailyUsage coverage — this query
// duplicates the same institution/subtree-scoped grade_count fix, so it needs
// its own regression test rather than relying on the platform-wide one.
describe('getInstitutionDailyUsage — grade_count is real grading actions, not LLM-call count', () => {
  it('counts one assignment as one check even when several LLM calls were logged as grading', async () => {
    const institution = await createTestInstitution()
    const teacher = await createTestTeacher({ institutionId: institution.id })
    const course = await createTestCourse(teacher.id)
    await createTestAssignment(teacher.id, course.id)

    for (let i = 0; i < 3; i++) {
      await createUsageLog({
        teacherId: teacher.id, feature: 'grading', model: 'deepseek-chat',
        inputTokens: 100, outputTokens: 50, costUsd: 0.001, durationMs: 500, success: true,
      })
    }

    const [today] = await getInstitutionDailyUsage(institution.id, 1)
    expect(today.grade_count).toBe(1)
  })

  it('does not leak another institution\'s grades into the count', async () => {
    const institution = await createTestInstitution()
    const otherInstitution = await createTestInstitution()
    const teacher = await createTestTeacher({ institutionId: institution.id })
    const otherTeacher = await createTestTeacher({ institutionId: otherInstitution.id })
    const course = await createTestCourse(teacher.id)
    const otherCourse = await createTestCourse(otherTeacher.id)
    await createTestAssignment(teacher.id, course.id)
    await createTestAssignment(otherTeacher.id, otherCourse.id)
    await createTestAssignment(otherTeacher.id, otherCourse.id)

    const [today] = await getInstitutionDailyUsage(institution.id, 1)
    expect(today.grade_count).toBe(1)
  })
})
