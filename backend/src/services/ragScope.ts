import { pool } from '../db/connection'

// Feature AN Phase 0 (TODO.md "### AN") — resolves a course into the scope
// set its document RAG retrieval is allowed to pool from: its own uploads
// ('course'), its кафедра/факультет's shared library ('unit', ancestor-walk
// via org_units.path), the institution pool ('institution', gated on the
// same institutions.shared_rag_enabled flag the assignments axis already
// uses — migration 036), and curated platform content ('platform', always
// on). Read-side only — this does NOT depend on the requesting teacher's own
// domain grants; the whole point is that any teacher generating content for
// a course sees what their кафедра/institution has pooled, independent of
// whether they personally hold any admin grant. Promotion (write-side) is
// gated separately via requireDomain('umu','edit') in routes/documents.ts.

export interface RagRetrievalScope {
  courseId:                string
  unitPath:                string | null   // course owner's primary_org_unit path, for ancestor LIKE match
  institutionId:           string | null
  institutionPoolEnabled:  boolean
}

interface ScopeRow {
  institution_id:          string | null
  institution_pool_enabled: boolean | null
  unit_path:                string | null
}

export async function resolveRagRetrievalScope(courseId: string): Promise<RagRetrievalScope> {
  const { rows } = await pool.query<ScopeRow>(
    `SELECT t.institution_id AS institution_id,
            i.shared_rag_enabled AS institution_pool_enabled,
            u.path AS unit_path
       FROM courses c
       JOIN teachers t ON t.id = c.teacher_id
       LEFT JOIN institutions i ON i.id = t.institution_id
       LEFT JOIN org_units u ON u.id = t.primary_org_unit_id
      WHERE c.id = $1
      LIMIT 1`,
    [courseId]
  )
  const row = rows[0]
  return {
    courseId,
    unitPath:               row?.unit_path ?? null,
    institutionId:           row?.institution_id ?? null,
    institutionPoolEnabled:  row?.institution_pool_enabled ?? false,
  }
}
