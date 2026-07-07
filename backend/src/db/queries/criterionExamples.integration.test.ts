import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { insertCriterionExample, findSimilarCriterionExamples } from './criterionExamples'
import { createTestTeacher, createTestCourse, createTestAssignment, unitVector256 } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('findSimilarCriterionExamples', () => {
  it('orders hits by cosine similarity — exact match first, near second, far last', async () => {
    const teacher = await createTestTeacher()
    const courseRow = await createTestCourse(teacher.id)
    const assignment = await createTestAssignment(teacher.id, courseRow.id)

    await insertCriterionExample({
      assignmentId: assignment.id, teacherId: teacher.id, courseId: courseRow.id,
      criterionName: 'Аргументация', score: 60, feedback: 'Далёкий пример', embedding: unitVector256(128),
    })
    await insertCriterionExample({
      assignmentId: assignment.id, teacherId: teacher.id, courseId: courseRow.id,
      criterionName: 'Аргументация', score: 90, feedback: 'Точный пример', embedding: unitVector256(0),
    })
    await insertCriterionExample({
      assignmentId: assignment.id, teacherId: teacher.id, courseId: courseRow.id,
      criterionName: 'Аргументация', score: 75, feedback: 'Близкий пример', embedding: unitVector256(0, 0.1),
    })

    const hits = await findSimilarCriterionExamples(courseRow.id, 'Аргументация', unitVector256(0), 5)

    expect(hits.map((h) => h.feedback)).toEqual(['Точный пример', 'Близкий пример', 'Далёкий пример'])
  })

  it('matches criterion_name case-insensitively', async () => {
    const teacher = await createTestTeacher()
    const courseRow = await createTestCourse(teacher.id)
    const assignment = await createTestAssignment(teacher.id, courseRow.id)

    await insertCriterionExample({
      assignmentId: assignment.id, teacherId: teacher.id, courseId: courseRow.id,
      criterionName: 'Аргументация', score: 80, feedback: 'Отзыв про аргументацию', embedding: unitVector256(0),
    })

    const hits = await findSimilarCriterionExamples(courseRow.id, 'аргументация', unitVector256(0), 5)
    expect(hits).toHaveLength(1)
    expect(hits[0].feedback).toBe('Отзыв про аргументацию')
  })

  it('never returns rows from a different course', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)
    const assignmentA = await createTestAssignment(teacher.id, courseA.id)

    await insertCriterionExample({
      assignmentId: assignmentA.id, teacherId: teacher.id, courseId: courseA.id,
      criterionName: 'Структура', score: 70, feedback: 'Отзыв в курсе A', embedding: unitVector256(0),
    })

    const hits = await findSimilarCriterionExamples(courseB.id, 'Структура', unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })

  it('respects the limit parameter', async () => {
    const teacher = await createTestTeacher()
    const courseRow = await createTestCourse(teacher.id)
    const assignment = await createTestAssignment(teacher.id, courseRow.id)

    for (let i = 0; i < 4; i++) {
      await insertCriterionExample({
        assignmentId: assignment.id, teacherId: teacher.id, courseId: courseRow.id,
        criterionName: 'Структура', score: 70 + i, feedback: `Отзыв ${i}`, embedding: unitVector256(i, 0.01),
      })
    }

    const hits = await findSimilarCriterionExamples(courseRow.id, 'Структура', unitVector256(0), 2)
    expect(hits).toHaveLength(2)
  })

  it('never returns rows for a different criterion name in the same course', async () => {
    const teacher = await createTestTeacher()
    const courseRow = await createTestCourse(teacher.id)
    const assignment = await createTestAssignment(teacher.id, courseRow.id)

    await insertCriterionExample({
      assignmentId: assignment.id, teacherId: teacher.id, courseId: courseRow.id,
      criterionName: 'Структура', score: 70, feedback: 'Отзыв про структуру', embedding: unitVector256(0),
    })

    const hits = await findSimilarCriterionExamples(courseRow.id, 'Аргументация', unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })
})
