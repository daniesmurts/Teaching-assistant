// Shared fixture helpers for the DB-backed integration suite. Prefers the
// real production query-layer functions (createTeacher, createCourse) over
// raw SQL where one already exists — more representative of what actually
// runs in production, and it's free regression coverage for those functions
// too. Raw SQL only where no function exposes the needed control.
import bcrypt from 'bcryptjs'
import { pool } from '../connection'
import { createTeacher } from '../queries/teachers'
import { createCourse, updateCourse } from '../queries/courses'
import { createProgram, replaceDisciplines, replaceCompetencies, getProgramDetail } from '../queries/programs'
import { createFgosStandardDraft, publishFgosStandard, getFgosStandardById } from '../queries/fgos'
import type { Teacher, Course, Program, ProgramDiscipline, ProgramCompetency } from '../../../../shared/types'

let counter = 0
function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now()}-${counter}`
}

export const TEST_PASSWORD = 'Test1234!'
let cachedPasswordHash: string | null = null

async function testPasswordHash(): Promise<string> {
  cachedPasswordHash ??= await bcrypt.hash(TEST_PASSWORD, 10)
  return cachedPasswordHash
}

export async function createTestTeacher(overrides?: {
  email?: string
  institutionId?: string
}): Promise<Teacher> {
  const email = overrides?.email ?? `${unique('teacher')}@example.test`
  return createTeacher(email, await testPasswordHash(), 'Test Teacher', undefined, undefined, overrides?.institutionId)
}

export interface TestInstitution {
  id: string
  name: string
  plan_tier: string
  shared_rag_enabled: boolean
}

/**
 * Raw SQL, not createInstitution() — that function also bootstraps an
 * org_units tree (institution-admin root unit, etc.), which is irrelevant
 * setup cost for RAG-pool tests that only need `shared_rag_enabled`.
 */
export async function createTestInstitution(overrides?: {
  planTier?: string
  sharedRagEnabled?: boolean
}): Promise<TestInstitution> {
  const { rows } = await pool.query<TestInstitution>(
    `INSERT INTO institutions (name, plan_tier, shared_rag_enabled)
     VALUES ($1, $2, $3)
     RETURNING id, name, plan_tier, shared_rag_enabled`,
    [unique('Test Institution'), overrides?.planTier ?? 'institution', overrides?.sharedRagEnabled ?? false]
  )
  return rows[0]
}

export async function createTestCourse(teacherId: string, overrides?: {
  name?: string
  code?: string
  shareRagWithInstitution?: boolean
}): Promise<Course> {
  const course = await createCourse(teacherId, {
    name: overrides?.name ?? unique('Test Course'),
    code: overrides?.code,
  })
  if (overrides?.shareRagWithInstitution) {
    const updated = await updateCourse(course.id, teacherId, { share_rag_with_institution: true })
    return updated ?? course
  }
  return course
}

export interface TestAssignment {
  id: string
  course_id: string
  approved_grade: string
  approved_score: number
}

/**
 * Raw SQL — no query function creates an already-approved assignment row
 * directly (createAssignment() always inserts status='pending'; approval
 * is a separate transactional step in approveAssignment()). RAG retrieval
 * only ever reads status='approved' rows, so tests need to seed them
 * directly rather than replaying the full grade-then-approve flow.
 */
export async function createTestAssignment(
  teacherId: string,
  courseId: string,
  overrides?: {
    approvedScore?: number
    approvedGrade?: string
    embedding?: number[]
    createdAt?: Date
  }
): Promise<TestAssignment> {
  const embeddingParam = overrides?.embedding ? `[${overrides.embedding.join(',')}]` : null
  const { rows } = await pool.query<TestAssignment>(
    `INSERT INTO assignments (
       teacher_id, course_id, submission_text, status,
       approved_score, approved_grade, approved_feedback, approved_at,
       embedding, created_at
     ) VALUES ($1, $2, $3, 'approved', $4, $5, 'test feedback', NOW(), $6, COALESCE($7, NOW()))
     RETURNING id, course_id, approved_grade, approved_score`,
    [
      teacherId, courseId, unique('Test submission text'),
      overrides?.approvedScore ?? 85, overrides?.approvedGrade ?? '4',
      embeddingParam, overrides?.createdAt ?? null,
    ]
  )
  return rows[0]
}

/**
 * Deterministic synthetic 256-dim embedding — a mostly-zero vector with one
 * non-zero component at `index`, optionally perturbed slightly so two
 * vectors at the same index aren't bit-identical. Cosine similarity between
 * unitVector256(0) and unitVector256(0) is always 1 (closest); between
 * unitVector256(0) and unitVector256(128) is always 0 (orthogonal, furthest)
 * — makes RAG ordering assertions exact instead of relying on random luck.
 */
export async function createTestProgram(
  institutionId: string, createdBy: string,
  overrides?: { name?: string; code?: string | null; level?: string | null }
): Promise<Program> {
  return createProgram(institutionId, createdBy, {
    name:  overrides?.name ?? unique('Test Program'),
    code:  overrides?.code,
    level: overrides?.level,
  })
}

/** Replaces (sets) a programme's full discipline list and returns the rows
 *  with their assigned ids — replaceDisciplines() itself returns void, so
 *  this re-fetches via getProgramDetail() (the real read path) rather than
 *  reconstructing ids from raw SQL. replaceDisciplines is id-preserving
 *  (see its own doc comment): pass back a previous call's `id` on any entry
 *  that should keep its identity (and any FK rows pointing at it) rather
 *  than being deleted and recreated as a new row. */
export async function createTestProgramDisciplines(
  institutionId: string, programId: string,
  disciplines: { id?: string; name: string; semester?: number; competencyCodes?: string[] }[]
): Promise<ProgramDiscipline[]> {
  await replaceDisciplines(programId, disciplines.map((d, i) => ({
    id:                d.id,
    course_id:         null,
    name:              d.name,
    semester:          d.semester ?? 1,
    credits:           null,
    control_form:      null,
    competency_codes:  d.competencyCodes ?? [],
    sort_order:        i,
  })))
  const detail = await getProgramDetail(programId, institutionId)
  return detail!.disciplines
}

/** Same replace-then-refetch pattern as createTestProgramDisciplines, for
 *  program_competencies. */
export async function createTestProgramCompetencies(
  institutionId: string, programId: string,
  competencies: { code: string; title?: string }[]
): Promise<ProgramCompetency[]> {
  await replaceCompetencies(programId, competencies.map((c, i) => ({
    kind:       'competency',
    code:       c.code,
    title:      c.title ?? c.code,
    sort_order: i,
  })))
  const detail = await getProgramDetail(programId, institutionId)
  return detail!.competencies
}

export interface TestFgosStandard {
  id:             string
  direction_code: string
  level:          string
  competencies:   { id: string; type: 'УК' | 'ОПК'; code: string }[]
}

/** Draft-then-publish, same two-step flow routes/adminFgos.ts uses — a
 *  draft standard is never authoritative (findPublishedFgosCompetencies
 *  filters to status='published'), so tests need the real publish step too,
 *  not just the draft insert. */
export async function createTestFgosStandard(
  createdBy: string,
  overrides?: {
    directionCode?: string
    level?: string
    competencies?: { type: 'УК' | 'ОПК'; code: string; formulation?: string }[]
  }
): Promise<TestFgosStandard> {
  // No uniqueness needed — each integration test runs inside its own rolled-
  // back transaction (see transactionalTestIsolation.ts), so a fixed default
  // never collides across tests.
  const directionCode = overrides?.directionCode ?? '09.03.01'
  const level = overrides?.level ?? 'бакалавриат'
  const comps = overrides?.competencies ?? [
    { type: 'УК' as const,  code: 'УК-1',  formulation: 'Test УК-1 formulation' },
    { type: 'ОПК' as const, code: 'ОПК-1', formulation: 'Test ОПК-1 formulation' },
  ]
  const payload = {
    standard: { direction_code: directionCode, level, title: unique('Test FGOS Standard') },
    competencies: comps.map((c) => ({
      type: c.type, code: c.code, formulation: c.formulation ?? c.code, is_verbatim_verified: true,
    })),
    structureRequirements: [],
    profstandardRefs: [],
  }
  const draft = await createFgosStandardDraft(payload, createdBy)
  await publishFgosStandard(draft.id, payload)
  const full = await getFgosStandardById(draft.id)
  return {
    id:             full!.id,
    direction_code: full!.direction_code,
    level:          full!.level,
    competencies:   full!.competencies.map((c) => ({ id: c.id, type: c.type, code: c.code })),
  }
}

export function unitVector256(index: number, perturbation = 0): number[] {
  const v = new Array(256).fill(0)
  v[index % 256] = 1
  if (perturbation !== 0) {
    const neighbour = (index + 1) % 256
    v[neighbour] = perturbation
  }
  return v
}
