import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { findRelevantChunksScored } from './chunks'
import { createTestTeacher, createTestCourse, unitVector256 } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function insertChunk(params: {
  teacherId: string; courseId: string; text: string; embedding: number[]; fileName?: string
}) {
  const { rows: docRows } = await pool.query<{ id: string }>(
    `INSERT INTO documents (teacher_id, course_id, file_name, file_type, mime_type, storage_path, document_type, processing_status)
     VALUES ($1, $2, $3, 'pdf', 'application/pdf', 'test/path', 'material', 'ready')
     RETURNING id`,
    [params.teacherId, params.courseId, params.fileName ?? 'test.pdf']
  )
  await pool.query(
    `INSERT INTO document_chunks (document_id, course_id, chunk_index, chunk_type, text, embedding)
     VALUES ($1, $2, 0, 'general', $3, $4)`,
    [docRows[0].id, params.courseId, params.text, `[${params.embedding.join(',')}]`]
  )
  return docRows[0].id
}

describe('findRelevantChunksScored', () => {
  it('orders by distance and reports it alongside the chunk', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    await insertChunk({ teacherId: teacher.id, courseId: course.id, text: 'far',   embedding: unitVector256(128) })
    await insertChunk({ teacherId: teacher.id, courseId: course.id, text: 'exact', embedding: unitVector256(0) })

    const hits = await findRelevantChunksScored(course.id, unitVector256(0), 5)
    expect(hits[0].text).toBe('exact')
    expect(hits[0].distance).toBeCloseTo(0, 5)
    expect(hits[1].text).toBe('far')
    expect(hits[1].distance).toBeGreaterThan(hits[0].distance)
  })

  it('returns nothing for a course with no chunks', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const hits = await findRelevantChunksScored(course.id, unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })

  it('never crosses courses', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)
    await insertChunk({ teacherId: teacher.id, courseId: courseA.id, text: 'in A', embedding: unitVector256(0) })

    const hits = await findRelevantChunksScored(courseB.id, unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })
})
