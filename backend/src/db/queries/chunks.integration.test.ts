import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { findRelevantChunksScored, findRelevantChunks, hasAnyChunksForCourse, type DocumentVisibilityScope } from './chunks'
import { createTestTeacher, createTestCourse, createTestInstitution, unitVector256 } from '../__tests__/fixtures'
import type { RagRetrievalScope } from '../../services/ragScope'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

function courseOnlyScope(courseId: string): RagRetrievalScope {
  return { courseId, unitPath: null, institutionId: null, institutionPoolEnabled: false }
}

async function insertChunk(params: {
  teacherId: string; courseId: string; text: string; embedding: number[]; fileName?: string
  visibilityScope?: DocumentVisibilityScope; scopeUnitId?: string | null
}) {
  const { rows: docRows } = await pool.query<{ id: string }>(
    `INSERT INTO documents (teacher_id, course_id, file_name, file_type, mime_type, storage_path, document_type, processing_status, visibility_scope, scope_unit_id)
     VALUES ($1, $2, $3, 'pdf', 'application/pdf', 'test/path', 'material', 'ready', $4, $5)
     RETURNING id`,
    [params.teacherId, params.courseId, params.fileName ?? 'test.pdf', params.visibilityScope ?? 'course', params.scopeUnitId ?? null]
  )
  await pool.query(
    `INSERT INTO document_chunks (document_id, course_id, chunk_index, chunk_type, text, embedding, visibility_scope, scope_unit_id)
     VALUES ($1, $2, 0, 'general', $3, $4, $5, $6)`,
    [docRows[0].id, params.courseId, params.text, `[${params.embedding.join(',')}]`, params.visibilityScope ?? 'course', params.scopeUnitId ?? null]
  )
  return docRows[0].id
}

async function insertOrgUnit(institutionId: string, overrides?: { parentId?: string | null; typeCode?: string; path?: string }) {
  const { rows } = await pool.query<{ id: string; path: string }>(
    `INSERT INTO org_units (institution_id, parent_id, type_code, name, path)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, path`,
    [institutionId, overrides?.parentId ?? null, overrides?.typeCode ?? 'department', `Test Unit ${Date.now()}-${Math.random()}`, overrides?.path ?? '/']
  )
  return rows[0]
}

describe('findRelevantChunksScored — own-course scope (default)', () => {
  it('orders by distance and reports it alongside the chunk', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)

    await insertChunk({ teacherId: teacher.id, courseId: course.id, text: 'far',   embedding: unitVector256(128) })
    await insertChunk({ teacherId: teacher.id, courseId: course.id, text: 'exact', embedding: unitVector256(0) })

    const hits = await findRelevantChunksScored(courseOnlyScope(course.id), unitVector256(0), 5)
    expect(hits[0].text).toBe('exact')
    expect(hits[0].distance).toBeCloseTo(0, 5)
    expect(hits[1].text).toBe('far')
    expect(hits[1].distance).toBeGreaterThan(hits[0].distance)
    expect(hits[0].source_scope).toBe('course')
  })

  it('returns nothing for a course with no chunks', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    const hits = await findRelevantChunksScored(courseOnlyScope(course.id), unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })

  it('never crosses courses when the other course is also course-scoped', async () => {
    const teacher = await createTestTeacher()
    const courseA = await createTestCourse(teacher.id)
    const courseB = await createTestCourse(teacher.id)
    await insertChunk({ teacherId: teacher.id, courseId: courseA.id, text: 'in A', embedding: unitVector256(0) })

    const hits = await findRelevantChunksScored(courseOnlyScope(courseB.id), unitVector256(0), 5)
    expect(hits).toHaveLength(0)
  })
})

describe('findRelevantChunks — Feature AN scope ladder', () => {
  it('unit-scoped chunks are pooled for a course under the same org subtree, not otherwise', async () => {
    const institution = await createTestInstitution()
    const dept   = await insertOrgUnit(institution.id, { path: '/inst/dept-a/' })
    const otherDept = await insertOrgUnit(institution.id, { path: '/inst/dept-b/' })

    const contributor = await createTestTeacher({ institutionId: institution.id })
    const reader       = await createTestTeacher({ institutionId: institution.id })
    await pool.query('UPDATE teachers SET primary_org_unit_id = $2 WHERE id = $1', [reader.id, dept.id])

    const readerCourse = await createTestCourse(reader.id)
    const contributorCourse = await createTestCourse(contributor.id)
    await insertChunk({
      teacherId: contributor.id, courseId: contributorCourse.id,
      text: 'кафедра material', embedding: unitVector256(0),
      visibilityScope: 'unit', scopeUnitId: dept.id,
    })

    const inScope: RagRetrievalScope = { courseId: readerCourse.id, unitPath: dept.path, institutionId: institution.id, institutionPoolEnabled: false }
    const hits = await findRelevantChunks(inScope, unitVector256(0), 5)
    expect(hits.map((h) => h.text)).toContain('кафедра material')
    expect(hits.find((h) => h.text === 'кафедра material')?.source_scope).toBe('unit')

    const outOfScope: RagRetrievalScope = { courseId: readerCourse.id, unitPath: otherDept.path, institutionId: institution.id, institutionPoolEnabled: false }
    const missHits = await findRelevantChunks(outOfScope, unitVector256(0), 5)
    expect(missHits.map((h) => h.text)).not.toContain('кафедра material')
  })

  it('institution-scoped chunks require institutionPoolEnabled AND same institution', async () => {
    const institution = await createTestInstitution({ sharedRagEnabled: true })
    const contributor = await createTestTeacher({ institutionId: institution.id })
    const reader       = await createTestTeacher({ institutionId: institution.id })
    const readerCourse = await createTestCourse(reader.id)

    await insertChunk({
      teacherId: contributor.id, courseId: (await createTestCourse(contributor.id)).id,
      text: 'institution pool', embedding: unitVector256(0), visibilityScope: 'institution',
    })

    const enabled: RagRetrievalScope = { courseId: readerCourse.id, unitPath: null, institutionId: institution.id, institutionPoolEnabled: true }
    const hits = await findRelevantChunks(enabled, unitVector256(0), 5)
    expect(hits.map((h) => h.text)).toContain('institution pool')

    const disabled: RagRetrievalScope = { ...enabled, institutionPoolEnabled: false }
    const missed = await findRelevantChunks(disabled, unitVector256(0), 5)
    expect(missed.map((h) => h.text)).not.toContain('institution pool')
  })

  it('platform-scoped chunks are always visible regardless of course/institution', async () => {
    const contributorTeacher = await createTestTeacher()
    const contributorCourse  = await createTestCourse(contributorTeacher.id)
    await insertChunk({
      teacherId: contributorTeacher.id, courseId: contributorCourse.id,
      text: 'platform curated', embedding: unitVector256(0), visibilityScope: 'platform',
    })

    const readerTeacher = await createTestTeacher()
    const readerCourse   = await createTestCourse(readerTeacher.id)
    const hits = await findRelevantChunks(courseOnlyScope(readerCourse.id), unitVector256(0), 5)
    expect(hits.map((h) => h.text)).toContain('platform curated')
  })

  it("own-course chunks are never displaced by pooled ones — pooled only tops up remaining slots", async () => {
    const institution = await createTestInstitution({ sharedRagEnabled: true })
    const teacher = await createTestTeacher({ institutionId: institution.id })
    const course  = await createTestCourse(teacher.id)

    await insertChunk({ teacherId: teacher.id, courseId: course.id, text: 'own 1', embedding: unitVector256(0) })
    await insertChunk({
      teacherId: teacher.id, courseId: (await createTestCourse(teacher.id)).id,
      text: 'pooled', embedding: unitVector256(0), visibilityScope: 'institution',
    })

    const scope: RagRetrievalScope = { courseId: course.id, unitPath: null, institutionId: institution.id, institutionPoolEnabled: true }
    const hits = await findRelevantChunks(scope, unitVector256(0), 1)
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('own 1')
  })
})

describe('hasAnyChunksForCourse — scope-aware existence probe', () => {
  it('is true when only pooled (not own-course) material exists', async () => {
    const institution = await createTestInstitution({ sharedRagEnabled: true })
    const contributor = await createTestTeacher({ institutionId: institution.id })
    const reader       = await createTestTeacher({ institutionId: institution.id })
    const readerCourse = await createTestCourse(reader.id)

    await insertChunk({
      teacherId: contributor.id, courseId: (await createTestCourse(contributor.id)).id,
      text: 'pooled only', embedding: unitVector256(0), visibilityScope: 'institution',
    })

    const scope: RagRetrievalScope = { courseId: readerCourse.id, unitPath: null, institutionId: institution.id, institutionPoolEnabled: true }
    expect(await hasAnyChunksForCourse(scope)).toBe(true)
  })

  it('is false with neither own nor pooled material', async () => {
    const teacher = await createTestTeacher()
    const course  = await createTestCourse(teacher.id)
    expect(await hasAnyChunksForCourse(courseOnlyScope(course.id))).toBe(false)
  })
})
