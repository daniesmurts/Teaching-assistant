import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getFeatureAdoption, getFeatureBreadth } from './featureAdoption'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function createQuiz(teacherId: string, courseId: string, daysAgo = 0): Promise<void> {
  await pool.query(
    `INSERT INTO quizzes (teacher_id, course_id, topic, question_count, questions, created_at)
     VALUES ($1, $2, 'Тема', 1, '[]'::jsonb, NOW() - ($3 || ' days')::INTERVAL)`,
    [teacherId, courseId, daysAgo]
  )
}

const find = <T extends { kind?: string; features_used?: number }>(rows: T[], p: Partial<T>): T => {
  const hit = rows.find((r) => Object.entries(p).every(([k, v]) => (r as Record<string, unknown>)[k] === v))
  if (!hit) throw new Error(`no row matching ${JSON.stringify(p)}`)
  return hit
}

describe('getFeatureAdoption', () => {
  // Two generations in one sitting is one session. Counting uses rather than
  // distinct days would make every feature look sticky on first contact.
  it('counts a teacher as returning only when they used the feature on a second day', async () => {
    const sameDay = await createTestTeacher()
    const courseA = await createTestCourse(sameDay.id)
    await createQuiz(sameDay.id, courseA.id, 0)
    await createQuiz(sameDay.id, courseA.id, 0)

    const cameBack = await createTestTeacher()
    const courseB = await createTestCourse(cameBack.id)
    await createQuiz(cameBack.id, courseB.id, 0)
    await createQuiz(cameBack.id, courseB.id, 3)

    const quiz = find(await getFeatureAdoption(30), { kind: 'quiz' })
    expect(quiz.teachers_ever).toBe(2)
    expect(quiz.teachers_returned).toBe(1)
    expect(quiz.avg_uses_per_teacher).toBe(2)
  })

  // A founder's own test data would visibly move every number on a platform
  // this size, exactly as the activation funnel already guards against.
  it('excludes platform admins from adoption', async () => {
    const admin = await createTestTeacher()
    await pool.query('UPDATE teachers SET is_platform_admin = TRUE WHERE id = $1', [admin.id])
    const course = await createTestCourse(admin.id)
    await createQuiz(admin.id, course.id)

    expect((await getFeatureAdoption(30)).find((r) => r.kind === 'quiz')).toBeUndefined()
  })

  it('measures discovery lag from signup, not from first use', async () => {
    const t = await createTestTeacher()
    await pool.query(`UPDATE teachers SET created_at = NOW() - INTERVAL '10 days' WHERE id = $1`, [t.id])
    const course = await createTestCourse(t.id)
    await createQuiz(t.id, course.id, 2)   // discovered 8 days after signing up

    const quiz = find(await getFeatureAdoption(30), { kind: 'quiz' })
    expect(quiz.median_days_to_first).toBeGreaterThan(7.5)
    expect(quiz.median_days_to_first).toBeLessThan(8.5)
  })
})

describe('getFeatureBreadth', () => {
  // Teachers who registered and created nothing exist in no artefact table;
  // a query that starts from those tables cannot see them at all.
  it('keeps registered-but-created-nothing teachers as an explicit 0 bucket', async () => {
    await createTestTeacher()

    const zero = find(await getFeatureBreadth(), { features_used: 0 })
    expect(zero.teachers).toBeGreaterThanOrEqual(1)
  })

  // Onboarding creates a course; if setup artefacts counted, everyone who
  // finished onboarding would read as "1 feature used" and the distribution
  // would say nothing.
  it('does not count a course as a feature used', async () => {
    const t = await createTestTeacher()
    await createTestCourse(t.id)

    const rows = await getFeatureBreadth()
    const withOne = rows.find((r) => r.features_used === 1)
    expect(withOne?.teachers ?? 0).toBe(0)
    expect(find(rows, { features_used: 0 }).teachers).toBeGreaterThanOrEqual(1)
  })

  it('counts distinct features, not how often each was used', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await createQuiz(t.id, course.id)
    await createQuiz(t.id, course.id)

    expect(find(await getFeatureBreadth(), { features_used: 1 }).teachers).toBe(1)
  })
})
