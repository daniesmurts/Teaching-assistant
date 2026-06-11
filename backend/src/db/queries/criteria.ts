import { pool } from '../connection'
import type { Criterion, CriterionSubject } from '../../../../shared/types'

interface CriterionRow {
  id: string
  teacher_id: string | null
  course_id: string | null
  name: string
  description: string | null
  subject: string | null
  is_global_template: boolean
  is_institution_shared: boolean
  created_at: Date
}

function toCriterion(row: CriterionRow): Criterion {
  return {
    id:                    row.id,
    teacher_id:            row.teacher_id,
    course_id:             row.course_id,
    name:                  row.name,
    description:           row.description,
    subject:               (row.subject ?? null) as CriterionSubject | null,
    is_global_template:    row.is_global_template,
    is_institution_shared: row.is_institution_shared,
    created_at:            row.created_at.toISOString(),
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

/** Personal criteria for one teacher. Optionally narrow to a course. */
export async function findCriteriaByTeacher(
  teacherId: string,
  courseId?: string
): Promise<Criterion[]> {
  if (courseId) {
    const { rows } = await pool.query<CriterionRow>(
      `SELECT * FROM criteria
        WHERE teacher_id = $1 AND is_global_template = FALSE
          AND (course_id = $2 OR course_id IS NULL)
        ORDER BY created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toCriterion)
  }
  const { rows } = await pool.query<CriterionRow>(
    `SELECT * FROM criteria
      WHERE teacher_id = $1 AND is_global_template = FALSE
      ORDER BY created_at DESC`,
    [teacherId]
  )
  return rows.map(toCriterion)
}

/** Global templates curated by platform admin. */
export async function findGlobalTemplates(): Promise<Criterion[]> {
  const { rows } = await pool.query<CriterionRow>(
    `SELECT * FROM criteria
      WHERE is_global_template = TRUE
      ORDER BY subject, name`
  )
  return rows.map(toCriterion)
}

/** Criteria shared across one institution (visible to all member teachers). */
export async function findCriteriaByInstitution(
  institutionId: string
): Promise<Array<Criterion & { author_name: string | null }>> {
  const { rows } = await pool.query<CriterionRow & { author_name: string | null }>(
    `SELECT c.*, t.name AS author_name
       FROM criteria c
       JOIN teachers t ON t.id = c.teacher_id
      WHERE t.institution_id = $1
        AND c.is_institution_shared = TRUE
        AND c.is_global_template = FALSE
      ORDER BY c.created_at DESC`,
    [institutionId]
  )
  return rows.map((r) => ({ ...toCriterion(r), author_name: r.author_name }))
}

export async function findCriterionById(
  id: string,
  teacherId: string
): Promise<Criterion | null> {
  const { rows } = await pool.query<CriterionRow>(
    `SELECT * FROM criteria
      WHERE id = $1
        AND (teacher_id = $2 OR is_global_template = TRUE
             OR teacher_id IN (
               SELECT id FROM teachers
                WHERE institution_id = (SELECT institution_id FROM teachers WHERE id = $2)
                  AND $3 IS NOT NULL
             ))
      LIMIT 1`,
    [id, teacherId, teacherId]   // last $3 is just a non-null marker
  )
  return rows[0] ? toCriterion(rows[0]) : null
}

/**
 * Load multiple criteria by id, scoped to what the teacher is allowed to use
 * (their own + global templates + institution-shared). Used when building the
 * snapshot at grading time.
 */
export async function findCriteriaByIds(
  ids: string[],
  teacherId: string,
  institutionId: string | null
): Promise<Criterion[]> {
  if (ids.length === 0) return []
  const { rows } = await pool.query<CriterionRow>(
    `SELECT DISTINCT c.*
       FROM criteria c
       LEFT JOIN teachers t ON t.id = c.teacher_id
      WHERE c.id = ANY($1::uuid[])
        AND (
          c.teacher_id = $2
          OR c.is_global_template = TRUE
          OR ($3::uuid IS NOT NULL
              AND c.is_institution_shared = TRUE
              AND t.institution_id = $3::uuid)
        )`,
    [ids, teacherId, institutionId]
  )
  return rows.map(toCriterion)
}

// ─── Writes ───────────────────────────────────────────────────────────────────

export async function createCriterion(
  teacherId: string,
  data: {
    name:        string
    description?: string
    course_id?:  string
    subject?:    CriterionSubject
    is_institution_shared?: boolean
  }
): Promise<Criterion> {
  const { rows } = await pool.query<CriterionRow>(
    `INSERT INTO criteria (teacher_id, course_id, name, description, subject, is_institution_shared)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      teacherId,
      data.course_id ?? null,
      data.name,
      data.description ?? null,
      data.subject ?? null,
      data.is_institution_shared ?? false,
    ]
  )
  return toCriterion(rows[0])
}

export async function updateCriterion(
  id: string,
  teacherId: string,
  data: {
    name?:        string
    description?: string | null
    course_id?:   string | null
    subject?:     CriterionSubject | null
  }
): Promise<Criterion | null> {
  const { rows } = await pool.query<CriterionRow>(
    `UPDATE criteria
        SET name        = COALESCE($3, name),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            course_id   = CASE WHEN $6::boolean THEN $7::uuid ELSE course_id END,
            subject     = CASE WHEN $8::boolean THEN $9 ELSE subject END
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [
      id, teacherId,
      data.name ?? null,
      data.description !== undefined, data.description ?? null,
      data.course_id   !== undefined, data.course_id   ?? null,
      data.subject     !== undefined, data.subject     ?? null,
    ]
  )
  return rows[0] ? toCriterion(rows[0]) : null
}

export async function deleteCriterion(
  id: string,
  teacherId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM criteria WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}

// ─── Admin / institution ──────────────────────────────────────────────────────

export async function createGlobalTemplate(
  data: { name: string; description?: string; subject?: CriterionSubject }
): Promise<Criterion> {
  const { rows } = await pool.query<CriterionRow>(
    `INSERT INTO criteria (teacher_id, name, description, subject, is_global_template)
     VALUES (NULL, $1, $2, $3, TRUE)
     RETURNING *`,
    [data.name, data.description ?? null, data.subject ?? 'general']
  )
  return toCriterion(rows[0])
}

export async function deleteGlobalTemplate(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM criteria WHERE id = $1 AND is_global_template = TRUE`,
    [id]
  )
  return (rowCount ?? 0) > 0
}
