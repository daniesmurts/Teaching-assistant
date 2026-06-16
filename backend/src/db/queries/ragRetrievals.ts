import { pool } from '../connection'

// ─── Cross-teacher use counts (institutional flywheel transparency) ──────────

/**
 * "How many times has this approved assignment been used as a RAG example
 * by another teacher in the same institution?" Powers the «Использовано
 * кафедрой» chip on the assignment detail modal.
 */
export async function getCrossInstitutionUseCount(
  assignmentId: string,
): Promise<{ count_lifetime: number; count_30d: number }> {
  const { rows } = await pool.query<{ lifetime: string; recent: string }>(
    `SELECT
       COUNT(*)                                                        AS lifetime,
       COUNT(*) FILTER (WHERE retrieved_at >= NOW() - INTERVAL '30 days') AS recent
       FROM rag_institution_uses
      WHERE retrieved_assignment_id = $1`,
    [assignmentId]
  )
  return {
    count_lifetime: Number(rows[0]?.lifetime ?? 0),
    count_30d:      Number(rows[0]?.recent   ?? 0),
  }
}

/** Aggregate cross-use count over the teacher's whole approved corpus. */
export async function getKafedraContribution30d(teacherId: string): Promise<number> {
  const { rows } = await pool.query<{ n: string }>(
    `SELECT COUNT(*) AS n
       FROM rag_institution_uses riu
       JOIN assignments retrieved ON retrieved.id = riu.retrieved_assignment_id
      WHERE retrieved.teacher_id = $1
        AND riu.retrieved_at >= NOW() - INTERVAL '30 days'`,
    [teacherId]
  )
  return Number(rows[0]?.n ?? 0)
}

/**
 * Bulk-insert one row per RAG example retrieved for a single grading call.
 * Fire-and-forget from the caller's perspective — a write failure here must
 * never block the grade itself, so the caller wraps the call in .catch().
 */
export async function recordRagRetrievals(
  gradingAssignmentId: string,
  examples: Array<{ id: string; similarity: number }>,
): Promise<void> {
  if (examples.length === 0) return

  // Single multi-VALUES insert — cheaper than N round-trips.
  const placeholders: string[] = []
  const params: unknown[] = [gradingAssignmentId]
  let p = 2
  for (const ex of examples) {
    placeholders.push(`($1, $${p++}, $${p++})`)
    params.push(ex.id, ex.similarity)
  }
  await pool.query(
    `INSERT INTO rag_retrievals (grading_assignment_id, retrieved_assignment_id, similarity_score)
     VALUES ${placeholders.join(', ')}`,
    params
  )
}
