import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import {
  findSimilarAssignments, resolveInstitutionPoolContext,
  findContrastingAssignment, findSimilarAssignmentsBefore,
} from './assignments'
import {
  createTestTeacher, createTestInstitution, createTestCourse, createTestAssignment, unitVector256,
} from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('findSimilarAssignments', () => {
  it('orders hits by cosine similarity — exact match first, near second, far last', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    const far   = await createTestAssignment(teacher.id, course.id, { embedding: unitVector256(128) })
    const exact = await createTestAssignment(teacher.id, course.id, { embedding: unitVector256(0) })
    const near  = await createTestAssignment(teacher.id, course.id, { embedding: unitVector256(0, 0.1) })

    const hits = await findSimilarAssignments(course.id, unitVector256(0), 5)

    expect(hits.map((h) => h.id)).toEqual([exact.id, near.id, far.id])
    expect(hits.every((h) => h.source === 'own')).toBe(true)
  })

  it('never returns unapproved (pending) assignments', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await pool.query(
      `INSERT INTO assignments (teacher_id, course_id, submission_text, status, embedding)
       VALUES ($1, $2, 'pending work', 'pending', $3)`,
      [teacher.id, course.id, `[${unitVector256(0).join(',')}]`]
    )
    const hits = await findSimilarAssignments(course.id, unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })
})

describe('institution pool — double opt-in gating', () => {
  async function setup(institutionShared: boolean, ownCourseShares: boolean, otherCourseShares: boolean) {
    const institution = await createTestInstitution({ sharedRagEnabled: institutionShared })
    const me    = await createTestTeacher({ institutionId: institution.id })
    const other = await createTestTeacher({ institutionId: institution.id })
    const myCourse    = await createTestCourse(me.id,    { code: 'CS101', shareRagWithInstitution: ownCourseShares })
    const otherCourse = await createTestCourse(other.id, { code: 'CS101', shareRagWithInstitution: otherCourseShares })
    await createTestAssignment(other.id, otherCourse.id, { embedding: unitVector256(0) })
    return { me, myCourse }
  }

  it('resolveInstitutionPoolContext is null when the institution master toggle is off', async () => {
    const { me, myCourse } = await setup(false, true, true)
    expect(await resolveInstitutionPoolContext(me.id, myCourse.id)).toBeNull()
  })

  it('resolveInstitutionPoolContext is null when the caller\'s own course has not opted in', async () => {
    const { me, myCourse } = await setup(true, false, true)
    expect(await resolveInstitutionPoolContext(me.id, myCourse.id)).toBeNull()
  })

  it('resolveInstitutionPoolContext resolves, but no cross-teacher hit appears if the OTHER course has not opted in', async () => {
    const { me, myCourse } = await setup(true, true, false)
    const context = await resolveInstitutionPoolContext(me.id, myCourse.id)
    expect(context).not.toBeNull()

    const hits = await findSimilarAssignments(myCourse.id, unitVector256(0), 5, context ?? undefined)
    expect(hits.every((h) => h.source === 'own')).toBe(true)
  })

  it('a cross-teacher hit appears only when both flags are true', async () => {
    const { me, myCourse } = await setup(true, true, true)
    const context = await resolveInstitutionPoolContext(me.id, myCourse.id)
    expect(context).not.toBeNull()

    const hits = await findSimilarAssignments(myCourse.id, unitVector256(0), 5, context ?? undefined)
    expect(hits.some((h) => h.source === 'institution')).toBe(true)
  })
})

describe('findContrastingAssignment', () => {
  it('returns the nearest neighbour with a different grade, excluding given ids', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    const sameGradeNear = await createTestAssignment(teacher.id, course.id, { approvedGrade: '5', embedding: unitVector256(0, 0.1) })
    const contrast       = await createTestAssignment(teacher.id, course.id, { approvedGrade: '3', embedding: unitVector256(0, 0.2) })

    const result = await findContrastingAssignment(course.id, unitVector256(0), [sameGradeNear.id], ['5'])
    expect(result?.id).toBe(contrast.id)
    expect(result?.contrastive).toBe(true)
  })

  it('returns null when every candidate is excluded by grade', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await createTestAssignment(teacher.id, course.id, { approvedGrade: '5', embedding: unitVector256(0) })

    const result = await findContrastingAssignment(course.id, unitVector256(0), [], ['5'])
    expect(result).toBeNull()
  })
})

describe('findSimilarAssignmentsBefore — no-future-leakage guarantee', () => {
  it('excludes assignments created after the cutoff', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    const before = await createTestAssignment(teacher.id, course.id, {
      embedding: unitVector256(0), createdAt: new Date('2020-01-01'),
    })
    const after = await createTestAssignment(teacher.id, course.id, {
      embedding: unitVector256(0, 0.1), createdAt: new Date('2020-06-01'),
    })

    const cutoff = new Date('2020-03-01')
    const hits = await findSimilarAssignmentsBefore(course.id, unitVector256(0), cutoff, '00000000-0000-0000-0000-000000000000', 5)

    expect(hits.map((h) => h.id)).toContain(before.id)
    expect(hits.map((h) => h.id)).not.toContain(after.id)
  })

  it('excludes the target itself even if its created_at is before the cutoff', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const target = await createTestAssignment(teacher.id, course.id, {
      embedding: unitVector256(0), createdAt: new Date('2020-01-01'),
    })

    const hits = await findSimilarAssignmentsBefore(course.id, unitVector256(0), new Date('2020-06-01'), target.id, 5)
    expect(hits.map((h) => h.id)).not.toContain(target.id)
  })
})
