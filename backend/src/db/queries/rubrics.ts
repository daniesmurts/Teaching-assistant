import { pool } from '../connection'
import type { Rubric, RubricItem, CriterionSubject } from '../../../../shared/types'

interface RubricRow {
  id:                    string
  teacher_id:            string | null
  course_id:             string | null
  name:                  string
  description:           string | null
  subject:               string | null
  items:                 RubricItem[]    // pg returns JSONB as parsed JS already
  is_global_template:    boolean
  is_institution_shared: boolean
  created_at:            Date
}

function toRubric(row: RubricRow): Rubric {
  return {
    id:                    row.id,
    teacher_id:            row.teacher_id,
    course_id:             row.course_id,
    name:                  row.name,
    description:           row.description,
    subject:               (row.subject ?? null) as CriterionSubject | null,
    items:                 Array.isArray(row.items) ? row.items : [],
    is_global_template:    row.is_global_template,
    is_institution_shared: row.is_institution_shared,
    created_at:            row.created_at.toISOString(),
  }
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function findRubricsByTeacher(
  teacherId: string,
  courseId?: string
): Promise<Rubric[]> {
  if (courseId) {
    const { rows } = await pool.query<RubricRow>(
      `SELECT * FROM rubrics
        WHERE teacher_id = $1 AND is_global_template = FALSE
          AND (course_id = $2 OR course_id IS NULL)
        ORDER BY created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toRubric)
  }
  const { rows } = await pool.query<RubricRow>(
    `SELECT * FROM rubrics
      WHERE teacher_id = $1 AND is_global_template = FALSE
      ORDER BY created_at DESC`,
    [teacherId]
  )
  return rows.map(toRubric)
}

export async function findGlobalRubricTemplates(): Promise<Rubric[]> {
  const { rows } = await pool.query<RubricRow>(
    `SELECT * FROM rubrics
      WHERE is_global_template = TRUE
      ORDER BY subject, name`
  )
  return rows.map(toRubric)
}

export async function findRubricsByInstitution(
  institutionId: string
): Promise<Array<Rubric & { author_name: string | null }>> {
  const { rows } = await pool.query<RubricRow & { author_name: string | null }>(
    `SELECT r.*, t.name AS author_name
       FROM rubrics r
       JOIN teachers t ON t.id = r.teacher_id
      WHERE t.institution_id = $1
        AND r.is_institution_shared = TRUE
        AND r.is_global_template = FALSE
      ORDER BY r.created_at DESC`,
    [institutionId]
  )
  return rows.map((r) => ({ ...toRubric(r), author_name: r.author_name }))
}

/** Resolve a single rubric the teacher is allowed to read (own + global + institution). */
export async function findRubricByIdForTeacher(
  id: string,
  teacherId: string,
  institutionId: string | null
): Promise<Rubric | null> {
  const { rows } = await pool.query<RubricRow>(
    `SELECT r.*
       FROM rubrics r
       LEFT JOIN teachers t ON t.id = r.teacher_id
      WHERE r.id = $1
        AND (
          r.teacher_id = $2
          OR r.is_global_template = TRUE
          OR ($3::uuid IS NOT NULL
              AND r.is_institution_shared = TRUE
              AND t.institution_id = $3::uuid)
        )
      LIMIT 1`,
    [id, teacherId, institutionId]
  )
  return rows[0] ? toRubric(rows[0]) : null
}

// ─── Writes (personal) ───────────────────────────────────────────────────────

interface RubricInput {
  name:         string
  description?: string
  course_id?:   string
  subject?:     CriterionSubject
  items:        RubricItem[]
}

export async function createRubric(
  teacherId: string,
  data: RubricInput
): Promise<Rubric> {
  const { rows } = await pool.query<RubricRow>(
    `INSERT INTO rubrics (teacher_id, course_id, name, description, subject, items)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)
     RETURNING *`,
    [
      teacherId,
      data.course_id ?? null,
      data.name,
      data.description ?? null,
      data.subject ?? null,
      JSON.stringify(data.items),
    ]
  )
  return toRubric(rows[0])
}

export async function updateRubric(
  id: string,
  teacherId: string,
  data: {
    name?:        string
    description?: string | null
    course_id?:   string | null
    subject?:     CriterionSubject | null
    items?:       RubricItem[]
  }
): Promise<Rubric | null> {
  const { rows } = await pool.query<RubricRow>(
    `UPDATE rubrics
        SET name        = COALESCE($3, name),
            description = CASE WHEN $4::boolean THEN $5 ELSE description END,
            course_id   = CASE WHEN $6::boolean THEN $7::uuid ELSE course_id END,
            subject     = CASE WHEN $8::boolean THEN $9 ELSE subject END,
            items       = CASE WHEN $10::boolean THEN $11::jsonb ELSE items END
      WHERE id = $1 AND teacher_id = $2
      RETURNING *`,
    [
      id, teacherId,
      data.name ?? null,
      data.description !== undefined, data.description ?? null,
      data.course_id   !== undefined, data.course_id   ?? null,
      data.subject     !== undefined, data.subject     ?? null,
      data.items       !== undefined, data.items ? JSON.stringify(data.items) : null,
    ]
  )
  return rows[0] ? toRubric(rows[0]) : null
}

export async function deleteRubric(
  id: string,
  teacherId: string
): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM rubrics WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}

// ─── Admin / institution ──────────────────────────────────────────────────────

export async function createGlobalRubricTemplate(
  data: Omit<RubricInput, 'course_id'>
): Promise<Rubric> {
  const { rows } = await pool.query<RubricRow>(
    `INSERT INTO rubrics (teacher_id, name, description, subject, items, is_global_template)
     VALUES (NULL, $1, $2, $3, $4::jsonb, TRUE)
     RETURNING *`,
    [data.name, data.description ?? null, data.subject ?? 'general', JSON.stringify(data.items)]
  )
  return toRubric(rows[0])
}

export async function updateGlobalRubricTemplate(
  id: string,
  data: {
    name?:        string
    description?: string | null
    subject?:     CriterionSubject | null
    items?:       RubricItem[]
  }
): Promise<Rubric | null> {
  const { rows } = await pool.query<RubricRow>(
    `UPDATE rubrics
        SET name        = COALESCE($2, name),
            description = CASE WHEN $3::boolean THEN $4 ELSE description END,
            subject     = CASE WHEN $5::boolean THEN $6 ELSE subject END,
            items       = CASE WHEN $7::boolean THEN $8::jsonb ELSE items END
      WHERE id = $1 AND is_global_template = TRUE
      RETURNING *`,
    [
      id,
      data.name ?? null,
      data.description !== undefined, data.description ?? null,
      data.subject     !== undefined, data.subject     ?? null,
      data.items       !== undefined, data.items ? JSON.stringify(data.items) : null,
    ]
  )
  return rows[0] ? toRubric(rows[0]) : null
}

export async function deleteGlobalRubricTemplate(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM rubrics WHERE id = $1 AND is_global_template = TRUE`,
    [id]
  )
  return (rowCount ?? 0) > 0
}

/**
 * Institution admin creates a rubric scoped to their institution. Stored under
 * the admin's teacher_id with is_institution_shared = TRUE.
 */
export async function createInstitutionRubric(
  adminTeacherId: string,
  data: Omit<RubricInput, 'course_id'>
): Promise<Rubric> {
  const { rows } = await pool.query<RubricRow>(
    `INSERT INTO rubrics (teacher_id, name, description, subject, items, is_institution_shared)
     VALUES ($1, $2, $3, $4, $5::jsonb, TRUE)
     RETURNING *`,
    [adminTeacherId, data.name, data.description ?? null, data.subject ?? null, JSON.stringify(data.items)]
  )
  return toRubric(rows[0])
}
