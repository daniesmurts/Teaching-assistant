// Shared fixture helpers for the DB-backed integration suite. Prefers the
// real production query-layer functions (createTeacher, createCourse) over
// raw SQL where one already exists — more representative of what actually
// runs in production, and it's free regression coverage for those functions
// too. Raw SQL only where no function exposes the needed control.
import bcrypt from 'bcryptjs'
import { pool } from '../connection'
import { createTeacher } from '../queries/teachers'
import { createCourse, updateCourse } from '../queries/courses'
import type { Teacher, Course } from '../../../../shared/types'

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
export function unitVector256(index: number, perturbation = 0): number[] {
  const v = new Array(256).fill(0)
  v[index % 256] = 1
  if (perturbation !== 0) {
    const neighbour = (index + 1) % 256
    v[neighbour] = perturbation
  }
  return v
}
