import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { findStudentTrajectory } from './assignments'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function insertGraded(params: {
  teacherId: string
  courseId: string
  studentName: string
  studentGroup?: string | null
  createdAt: Date
  approvedScore?: number
  approvedGrade?: string
  approvedCriteriaScores?: unknown
}) {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assignments (
       teacher_id, course_id, student_name, student_group, submission_text, status,
       approved_score, approved_grade, approved_feedback, approved_at,
       approved_criteria_scores, created_at
     ) VALUES ($1, $2, $3, $4, 'text', 'approved', $5, $6, 'fb', NOW(), $7, $8)
     RETURNING id`,
    [
      params.teacherId, params.courseId, params.studentName, params.studentGroup ?? null,
      params.approvedScore ?? 80, params.approvedGrade ?? '4',
      params.approvedCriteriaScores ? JSON.stringify(params.approvedCriteriaScores) : null,
      params.createdAt,
    ]
  )
  return rows[0].id
}

describe('findStudentTrajectory', () => {
  it('returns the newest-first history, excluding the current assignment', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Иванов И.', studentGroup: '101', createdAt: new Date('2026-06-01'), approvedScore: 60 })
    const mid  = await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Иванов И.', studentGroup: '101', createdAt: new Date('2026-06-10'), approvedScore: 70 })
    const current = await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Иванов И.', studentGroup: '101', createdAt: new Date('2026-06-20'), approvedScore: 90 })

    const trajectory = await findStudentTrajectory(teacher.id, 'Иванов И.', '101', { courseId: course.id, excludeId: current, limit: 3 })

    expect(trajectory).toHaveLength(2)
    expect(trajectory[0].score).toBe(70)
    expect(trajectory[0].id).toBe(mid)
    expect(trajectory[1].score).toBe(60)
  })

  it('matches NULL student_group to NULL (not to a specific group)', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Петров П.', studentGroup: null, createdAt: new Date('2026-06-01') })
    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Петров П.', studentGroup: '202', createdAt: new Date('2026-06-02') })

    const trajectory = await findStudentTrajectory(teacher.id, 'Петров П.', null, { courseId: course.id })
    expect(trajectory).toHaveLength(1)
  })

  it('scopes to the given course — a same-named student in another course is excluded', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)

    await insertGraded({ teacherId: teacher.id, courseId: courseA.id, studentName: 'Сидоров С.', createdAt: new Date('2026-06-01') })
    await insertGraded({ teacherId: teacher.id, courseId: courseB.id, studentName: 'Сидоров С.', createdAt: new Date('2026-06-02') })

    const trajectory = await findStudentTrajectory(teacher.id, 'Сидоров С.', null, { courseId: courseA.id })
    expect(trajectory).toHaveLength(1)
  })

  it('spans all courses when no courseId filter is given', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)

    await insertGraded({ teacherId: teacher.id, courseId: courseA.id, studentName: 'Кузнецова А.', createdAt: new Date('2026-06-01') })
    await insertGraded({ teacherId: teacher.id, courseId: courseB.id, studentName: 'Кузнецова А.', createdAt: new Date('2026-06-02') })

    const trajectory = await findStudentTrajectory(teacher.id, 'Кузнецова А.', null, {})
    expect(trajectory).toHaveLength(2)
  })

  it('respects the limit and returns approved_criteria_scores for per-criterion movement', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const scores = [{ name: 'Аргументация', score: 72, feedback: 'fb' }]

    for (let i = 0; i < 5; i++) {
      await insertGraded({
        teacherId: teacher.id, courseId: course.id, studentName: 'Смирнов В.',
        createdAt: new Date(2026, 5, i + 1),
        approvedCriteriaScores: i === 4 ? scores : undefined,
      })
    }

    const trajectory = await findStudentTrajectory(teacher.id, 'Смирнов В.', null, { courseId: course.id, limit: 3 })
    expect(trajectory).toHaveLength(3)
    expect(trajectory[0].criteria_scores).toEqual(scores)
  })

  it('never crosses teachers', async () => {
    const me    = await createTestTeacher()
    const other = await createTestTeacher()
    const myCourse    = await createTestCourse(me.id)
    const otherCourse = await createTestCourse(other.id)

    await insertGraded({ teacherId: other.id, courseId: otherCourse.id, studentName: 'Общий С.', createdAt: new Date('2026-06-01') })

    const trajectory = await findStudentTrajectory(me.id, 'Общий С.', null, { courseId: myCourse.id })
    expect(trajectory).toHaveLength(0)
  })
})
