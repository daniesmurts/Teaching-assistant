import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { getArtifactUsage, ARTIFACT_SOURCES } from './artifactUsage'
import { createTestTeacher, createTestCourse, createTestAssignment } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const row = (rows: Awaited<ReturnType<typeof getArtifactUsage>>, kind: string) => {
  const found = rows.find((r) => r.kind === kind)
  if (!found) throw new Error(`kind ${kind} missing from result`)
  return found
}

async function createQuiz(teacherId: string, courseId: string): Promise<void> {
  await pool.query(
    `INSERT INTO quizzes (teacher_id, course_id, topic, question_count, questions)
     VALUES ($1, $2, 'Тема', 1, '[]'::jsonb)`,
    [teacherId, courseId]
  )
}

// Every identifier in ARTIFACT_SOURCES is a hardcoded table/column name, so a
// renamed or dropped column would only surface at runtime on the admin page.
// This is the guard: the query must execute against the real migrated schema.
describe('getArtifactUsage — schema contract', () => {
  it('runs against every registered artefact table', async () => {
    const rows = await getArtifactUsage(30)
    expect(rows).toHaveLength(ARTIFACT_SOURCES.length)
  })

  it('reports a kind nobody has ever used as an explicit zero, not a missing row', async () => {
    const rows = await getArtifactUsage(30)
    const quiz = row(rows, 'quiz')
    expect(quiz.period_count).toBe(0)
    expect(quiz.total_count).toBe(0)
    expect(quiz.last_at).toBeNull()
  })
})

describe('getArtifactUsage — counts', () => {
  it('counts each artefact kind separately instead of folding them into one spend bucket', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await createTestAssignment(t.id, course.id)
    await createQuiz(t.id, course.id)
    await createQuiz(t.id, course.id)

    const rows = await getArtifactUsage(30)
    expect(row(rows, 'grading').period_count).toBe(1)
    expect(row(rows, 'quiz').period_count).toBe(2)
    expect(row(rows, 'course').period_count).toBe(1)
  })

  it('counts distinct teachers, not artefacts, in period_teachers', async () => {
    const a = await createTestTeacher()
    const b = await createTestTeacher()
    const courseA = await createTestCourse(a.id)
    const courseB = await createTestCourse(b.id)
    await createQuiz(a.id, courseA.id)
    await createQuiz(a.id, courseA.id)
    await createQuiz(b.id, courseB.id)

    const quiz = row(await getArtifactUsage(30), 'quiz')
    expect(quiz.period_count).toBe(3)
    expect(quiz.period_teachers).toBe(2)
  })

  it('keeps an artefact outside the window in total_count but out of period_count', async () => {
    const t = await createTestTeacher()
    const course = await createTestCourse(t.id)
    await createQuiz(t.id, course.id)
    await pool.query(`UPDATE quizzes SET created_at = NOW() - INTERVAL '90 days' WHERE teacher_id = $1`, [t.id])

    const quiz = row(await getArtifactUsage(30), 'quiz')
    expect(quiz.period_count).toBe(0)
    expect(quiz.period_teachers).toBe(0)
    expect(quiz.total_count).toBe(1)
    expect(quiz.last_at).not.toBeNull()
  })
})
