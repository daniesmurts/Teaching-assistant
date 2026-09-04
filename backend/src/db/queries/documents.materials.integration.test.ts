import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { createDocument, listDocumentsForCourse, deleteDocumentOwnedByTeacher } from './documents'
import { createTestTeacher, createTestCourse } from '../__tests__/fixtures'

// Feature AN follow-up — "do we have UI for uploading course content?"
// surfaced that document_type='material' had a backend but no frontend and
// no listing endpoint. Covers the two query functions that back the new
// GET /api/documents and DELETE /api/documents/:id routes
// (components/courses/CourseMaterials.tsx).

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

async function upload(teacherId: string, courseId: string, fileName: string, documentType: 'material' | 'syllabus' | 'assignment' = 'material') {
  return createDocument({
    teacherId, courseId, fileName, fileType: 'pdf', mimeType: 'application/pdf',
    fileSizeBytes: 1024, storagePath: `test/${fileName}`, documentType,
  })
}

describe('listDocumentsForCourse', () => {
  it('lists only the requesting teacher\'s own documents for the course, not a colleague\'s', async () => {
    const teacher = await createTestTeacher()
    const other   = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    await upload(teacher.id, course.id, 'first.pdf')
    await upload(teacher.id, course.id, 'second.pdf')
    await upload(other.id, course.id, 'not-mine.pdf')

    const docs = await listDocumentsForCourse(course.id, teacher.id)
    // created_at can tie at millisecond resolution within one transaction —
    // ownership scoping is what this test covers, not tiebreak ordering.
    expect(docs.map((d) => d.file_name).sort()).toEqual(['first.pdf', 'second.pdf'])
  })

  it('filters by document type when given', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    await upload(teacher.id, course.id, 'programme.pdf', 'syllabus')
    await upload(teacher.id, course.id, 'material.pdf', 'material')

    const materials = await listDocumentsForCourse(course.id, teacher.id, 'material')
    expect(materials.map((d) => d.file_name)).toEqual(['material.pdf'])
  })

  it('never crosses courses', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)
    await upload(teacher.id, courseA.id, 'in-a.pdf')

    const docs = await listDocumentsForCourse(courseB.id, teacher.id)
    expect(docs).toHaveLength(0)
  })
})

describe('deleteDocumentOwnedByTeacher', () => {
  it('deletes and returns the storage path when the teacher owns the document', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const doc = await upload(teacher.id, course.id, 'to-delete.pdf')

    const storagePath = await deleteDocumentOwnedByTeacher(doc.id, teacher.id)
    expect(storagePath).toBe('test/to-delete.pdf')

    const remaining = await listDocumentsForCourse(course.id, teacher.id)
    expect(remaining).toHaveLength(0)
  })

  it("returns null and deletes nothing when the caller doesn't own the document", async () => {
    const owner  = await createTestTeacher()
    const other  = await createTestTeacher()
    const course = await createTestCourse(owner.id)
    const doc = await upload(owner.id, course.id, 'protected.pdf')

    const result = await deleteDocumentOwnedByTeacher(doc.id, other.id)
    expect(result).toBeNull()

    const remaining = await listDocumentsForCourse(course.id, owner.id)
    expect(remaining).toHaveLength(1)
  })
})
