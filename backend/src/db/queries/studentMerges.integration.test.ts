import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { mergeStudentIdentity, undoStudentMerge, listStudentMerges, StudentMergeError } from './studentMerges'
import { findStudentsByTeacher } from './assignments'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function insertGraded(params: {
  teacherId: string; courseId: string; studentName: string; studentGroup?: string | null
  score?: number
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO assignments (teacher_id, course_id, student_name, student_group, submission_text, status, approved_score, approved_grade, approved_at)
     VALUES ($1, $2, $3, $4, 'text', 'approved', $5, '4', NOW())
     RETURNING id`,
    [params.teacherId, params.courseId, params.studentName, params.studentGroup ?? null, params.score ?? 80]
  )
  return rows[0].id
}

const nameOf = async (id: string) => {
  const { rows } = await pool.query<{ student_name: string; student_group: string | null }>(
    `SELECT student_name, student_group FROM assignments WHERE id = $1`, [id]
  )
  return rows[0]
}

describe('mergeStudentIdentity', () => {
  it('collapses two roster entries into one and merges their history', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Алтышев Н.И', score: 60 })
    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Алтышев Назар Игоревич', studentGroup: '251-МО21', score: 80 })

    expect(await findStudentsByTeacher(teacher.id)).toHaveLength(2)

    const merge = await mergeStudentIdentity(
      teacher.id,
      { name: 'Алтышев Н.И', group: null },
      { name: 'Алтышев Назар Игоревич', group: '251-МО21' },
      'suggested',
    )
    expect(merge?.row_count).toBe(1)

    const roster = await findStudentsByTeacher(teacher.id)
    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({
      student_name: 'Алтышев Назар Игоревич', student_group: '251-МО21', submissions: 2, avg_score: 70,
    })
  })

  it('matches a NULL group — the common case, since the blank group is why the duplicate exists', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const id = await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Петрова А.С.' })

    const merge = await mergeStudentIdentity(
      teacher.id, { name: 'Петрова А.С.', group: null }, { name: 'Петрова Анна Сергеевна', group: '251-МО21' },
    )
    expect(merge?.row_count).toBe(1)
    expect(await nameOf(id)).toEqual({ student_name: 'Петрова Анна Сергеевна', student_group: '251-МО21' })
  })

  it('never touches another teacher\'s student of the same name', async () => {
    const me    = await createTestTeacher()
    const other = await createTestTeacher()
    const myCourse    = await createTestCourse(me.id)
    const otherCourse = await createTestCourse(other.id)
    await insertGraded({ teacherId: me.id, courseId: myCourse.id, studentName: 'Алтышев Н.И' })
    const theirs = await insertGraded({ teacherId: other.id, courseId: otherCourse.id, studentName: 'Алтышев Н.И' })

    await mergeStudentIdentity(me.id, { name: 'Алтышев Н.И', group: null }, { name: 'Алтышев Назар Игоревич', group: null })

    expect((await nameOf(theirs)).student_name).toBe('Алтышев Н.И')
  })

  it('rewrites the other tables that carry the identity', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Алтышев Н.И' })

    const { rows: [review] } = await pool.query<{ id: string }>(
      `INSERT INTO long_reviews (teacher_id, course_id, student_name, student_group, submission_text)
       VALUES ($1, $2, 'Алтышев Н.И', NULL, 'вкр') RETURNING id`,
      [teacher.id, course.id]
    )
    const { rows: [topics] } = await pool.query<{ id: string }>(
      `INSERT INTO topic_sets (teacher_id, course_id, student_name, student_group, level, work_type, topics)
       VALUES ($1, $2, 'Алтышев Н.И', NULL, 'bachelor', 'coursework', '[]'::jsonb) RETURNING id`,
      [teacher.id, course.id]
    )

    const merge = await mergeStudentIdentity(
      teacher.id, { name: 'Алтышев Н.И', group: null }, { name: 'Алтышев Назар Игоревич', group: '251-МО21' },
    )
    expect(merge?.row_count).toBe(3)

    const { rows: r } = await pool.query(`SELECT student_name, student_group FROM long_reviews WHERE id = $1`, [review.id])
    expect(r[0]).toEqual({ student_name: 'Алтышев Назар Игоревич', student_group: '251-МО21' })
    const { rows: t } = await pool.query(`SELECT student_name FROM topic_sets WHERE id = $1`, [topics.id])
    expect(t[0].student_name).toBe('Алтышев Назар Игоревич')
  })

  it('returns null and records nothing when the source no longer exists', async () => {
    const teacher = await createTestTeacher()
    const merge = await mergeStudentIdentity(
      teacher.id, { name: 'Кого-то нет', group: null }, { name: 'Алтышев Назар Игоревич', group: null },
    )
    expect(merge).toBeNull()
    expect(await listStudentMerges(teacher.id)).toHaveLength(0)
  })

  it('refuses to merge an identity with itself', async () => {
    const teacher = await createTestTeacher()
    await expect(mergeStudentIdentity(
      teacher.id, { name: 'Алтышев Н.И', group: null }, { name: 'Алтышев Н.И', group: null },
    )).rejects.toBeInstanceOf(StudentMergeError)
  })
})

describe('undoStudentMerge', () => {
  it('restores the original spelling', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const id = await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Алтышев Н.И' })

    const merge = await mergeStudentIdentity(
      teacher.id, { name: 'Алтышев Н.И', group: null }, { name: 'Алтышев Назар Игоревич', group: '251-МО21' },
    )
    const undone = await undoStudentMerge(teacher.id, merge!.id)

    expect(undone?.undone_at).not.toBeNull()
    expect(await nameOf(id)).toEqual({ student_name: 'Алтышев Н.И', student_group: null })
    // Append-only: the record survives the undo (rule 5).
    expect(await listStudentMerges(teacher.id)).toHaveLength(1)
  })

  it('leaves work graded under the target name after the merge alone', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Алтышев Н.И' })

    const merge = await mergeStudentIdentity(
      teacher.id, { name: 'Алтышев Н.И', group: null }, { name: 'Алтышев Назар Игоревич', group: '251-МО21' },
    )
    // A new work arrives under the target name — it was never part of the merge.
    const later = await insertGraded({
      teacherId: teacher.id, courseId: course.id,
      studentName: 'Алтышев Назар Игоревич', studentGroup: '251-МО21',
    })

    await undoStudentMerge(teacher.id, merge!.id)
    expect((await nameOf(later)).student_name).toBe('Алтышев Назар Игоревич')
  })

  it('cannot be replayed, and cannot be run by another teacher', async () => {
    const teacher = await createTestTeacher()
    const other   = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await insertGraded({ teacherId: teacher.id, courseId: course.id, studentName: 'Алтышев Н.И' })

    const merge = await mergeStudentIdentity(
      teacher.id, { name: 'Алтышев Н.И', group: null }, { name: 'Алтышев Назар Игоревич', group: null },
    )
    expect(await undoStudentMerge(other.id, merge!.id)).toBeNull()
    expect(await undoStudentMerge(teacher.id, merge!.id)).not.toBeNull()
    expect(await undoStudentMerge(teacher.id, merge!.id)).toBeNull()
  })
})
