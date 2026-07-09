import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { findCohortRows } from './assignments'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function insertGraded(params: {
  teacherId: string; courseId: string; studentName: string; studentGroup?: string | null
  approvedScore?: number; approvedGrade?: string
}) {
  await pool.query(
    `INSERT INTO assignments (teacher_id, course_id, student_name, student_group, submission_text, status, approved_score, approved_grade, approved_feedback, approved_at)
     VALUES ($1, $2, $3, $4, 'text', 'approved', $5, $6, 'fb', NOW())`,
    [params.teacherId, params.courseId, params.studentName, params.studentGroup ?? null, params.approvedScore ?? 80, params.approvedGrade ?? '4']
  )
}

describe('findCohortRows', () => {
  it('excludes rows with no student name and scopes to the teacher + course', async () => {
    const me    = await createTestTeacher()
    const other = await createTestTeacher()
    const myCourse    = await createTestCourse(me.id)
    const otherCourse = await createTestCourse(other.id)

    await insertGraded({ teacherId: me.id, courseId: myCourse.id, studentName: 'Иванов' })
    await insertGraded({ teacherId: other.id, courseId: otherCourse.id, studentName: 'Чужой' })
    await pool.query(
      `INSERT INTO assignments (teacher_id, course_id, submission_text, status) VALUES ($1, $2, 'text', 'pending')`,
      [me.id, myCourse.id]
    )

    const rows = await findCohortRows(me.id, myCourse.id)
    expect(rows).toHaveLength(1)
    expect(rows[0].student_name).toBe('Иванов')
  })

  it('spans all of a teacher\'s courses when no courseId filter is given', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)
    await insertGraded({ teacherId: teacher.id, courseId: courseA.id, studentName: 'А' })
    await insertGraded({ teacherId: teacher.id, courseId: courseB.id, studentName: 'Б' })

    const rows = await findCohortRows(teacher.id)
    expect(rows).toHaveLength(2)
  })
})
