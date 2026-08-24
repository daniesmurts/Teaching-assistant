import { pool } from '../connection'
import type { SharedRagSummary } from '../../../../shared/types'

// ─── Institution master toggle ───────────────────────────────────────────────

export async function setInstitutionSharedRag(
  institutionId: string,
  enabled: boolean,
): Promise<void> {
  await pool.query(
    `UPDATE institutions SET shared_rag_enabled = $2 WHERE id = $1`,
    [institutionId, enabled]
  )
}

// ─── Roster + usage ──────────────────────────────────────────────────────────

export async function getSharedRagSummary(institutionId: string): Promise<SharedRagSummary> {
  // Single round-trip with four parallel queries — totals are tiny.
  const [enabledRow, courses, totals] = await Promise.all([
    pool.query<{ enabled: boolean }>(
      `SELECT shared_rag_enabled AS enabled FROM institutions WHERE id = $1`,
      [institutionId]
    ),

    // All shared courses across the institution. Counts of approved grades
    // and 30-day cross-use come from subqueries — at MVP scale that's fine,
    // promote to a JOIN if it ever shows up hot.
    pool.query<{
      course_id:       string
      course_name:     string
      course_code:     string | null
      teacher_id:      string
      teacher_name:    string | null
      approved_n:      string
      cross_uses_30d:  string
    }>(
      `SELECT
         c.id                AS course_id,
         c.name              AS course_name,
         c.code              AS course_code,
         t.id                AS teacher_id,
         t.name              AS teacher_name,
         (SELECT COUNT(*) FROM assignments a
            WHERE a.course_id = c.id AND a.status = 'approved')         AS approved_n,
         (SELECT COUNT(*) FROM rag_institution_uses riu
            JOIN assignments retrieved ON retrieved.id = riu.retrieved_assignment_id
           WHERE retrieved.course_id = c.id
             AND riu.retrieved_at >= NOW() - INTERVAL '30 days')         AS cross_uses_30d
       FROM courses c
       JOIN teachers t ON t.id = c.teacher_id
      WHERE t.institution_id = $1
        AND c.share_rag_with_institution = TRUE
      ORDER BY LOWER(COALESCE(c.code, c.name)), c.name`,
      [institutionId]
    ),

    pool.query<{
      shared_courses_n:          string
      participating_teachers_n:  string
      cross_uses_30d:            string
    }>(
      `SELECT
         (SELECT COUNT(*) FROM courses c
            JOIN teachers t ON t.id = c.teacher_id
           WHERE t.institution_id = $1 AND c.share_rag_with_institution = TRUE) AS shared_courses_n,
         (SELECT COUNT(DISTINCT t.id) FROM courses c
            JOIN teachers t ON t.id = c.teacher_id
           WHERE t.institution_id = $1 AND c.share_rag_with_institution = TRUE) AS participating_teachers_n,
         (SELECT COUNT(*) FROM rag_institution_uses
           WHERE institution_id = $1
             AND retrieved_at >= NOW() - INTERVAL '30 days')                    AS cross_uses_30d`,
      [institutionId]
    ),
  ])

  const t = totals.rows[0]
  return {
    enabled:                  enabledRow.rows[0]?.enabled ?? false,
    shared_courses_n:         Number(t.shared_courses_n),
    participating_teachers_n: Number(t.participating_teachers_n),
    cross_uses_30d:           Number(t.cross_uses_30d),
    courses: courses.rows.map((c) => ({
      course_id:      c.course_id,
      course_name:    c.course_name,
      course_code:    c.course_code,
      teacher_id:     c.teacher_id,
      teacher_name:   c.teacher_name,
      approved_n:     Number(c.approved_n),
      cross_uses_30d: Number(c.cross_uses_30d),
    })),
  }
}
