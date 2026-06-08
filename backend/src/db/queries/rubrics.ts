import { pool } from '../connection'
import type { Rubric, RubricCriterion } from '../../../../shared/types'

interface RubricRow {
  id: string
  teacher_id: string
  course_id: string | null
  name: string
  criteria: RubricCriterion[]
  is_default: boolean
  created_at: Date
}

function toRubric(row: RubricRow): Rubric {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    course_id: row.course_id,
    name: row.name,
    criteria: row.criteria,
    is_default: row.is_default,
    created_at: row.created_at.toISOString(),
  }
}

/** Global template rubrics (created by platform admin) — starting points for teachers. */
export async function findGlobalTemplates(): Promise<Array<Rubric & { template_subject: string | null }>> {
  const { rows } = await pool.query<RubricRow & { template_subject: string | null }>(
    `SELECT * FROM rubrics WHERE is_global_template = TRUE ORDER BY template_subject, name`
  )
  return rows.map((r) => ({ ...toRubric(r), template_subject: r.template_subject }))
}

export async function findRubricsByTeacher(teacherId: string, courseId?: string): Promise<Rubric[]> {
  if (courseId) {
    const { rows } = await pool.query<RubricRow>(
      `SELECT * FROM rubrics
       WHERE teacher_id = $1 AND is_global_template = FALSE
         AND (course_id = $2 OR course_id IS NULL)
       ORDER BY is_default DESC, created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toRubric)
  }
  const { rows } = await pool.query<RubricRow>(
    `SELECT * FROM rubrics
     WHERE teacher_id = $1 AND is_global_template = FALSE
     ORDER BY is_default DESC, created_at DESC`,
    [teacherId]
  )
  return rows.map(toRubric)
}

/** Institution-shared rubrics (created via the institution admin panel). */
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

export async function findRubricById(id: string, teacherId: string): Promise<Rubric | null> {
  const { rows } = await pool.query<RubricRow>(
    'SELECT * FROM rubrics WHERE id = $1 AND teacher_id = $2 LIMIT 1',
    [id, teacherId]
  )
  return rows[0] ? toRubric(rows[0]) : null
}

export async function createRubric(
  teacherId: string,
  data: {
    name: string; course_id?: string; criteria: RubricCriterion[]
    is_default?: boolean; is_institution_shared?: boolean
  }
): Promise<Rubric> {
  const { rows } = await pool.query<RubricRow>(
    `INSERT INTO rubrics (teacher_id, course_id, name, criteria, is_default, is_institution_shared)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [teacherId, data.course_id ?? null, data.name, JSON.stringify(data.criteria),
     data.is_default ?? false, data.is_institution_shared ?? false]
  )
  return toRubric(rows[0])
}

export async function updateRubric(
  id: string,
  teacherId: string,
  data: { name?: string; criteria?: RubricCriterion[]; is_default?: boolean }
): Promise<Rubric | null> {
  const { rows } = await pool.query<RubricRow>(
    `UPDATE rubrics
     SET name       = COALESCE($3, name),
         criteria   = COALESCE($4, criteria),
         is_default = COALESCE($5, is_default)
     WHERE id = $1 AND teacher_id = $2
     RETURNING *`,
    [id, teacherId, data.name ?? null, data.criteria ? JSON.stringify(data.criteria) : null, data.is_default ?? null]
  )
  return rows[0] ? toRubric(rows[0]) : null
}

export async function deleteRubric(id: string, teacherId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM rubrics WHERE id = $1 AND teacher_id = $2',
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}
