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

export async function findRubricsByTeacher(teacherId: string, courseId?: string): Promise<Rubric[]> {
  if (courseId) {
    const { rows } = await pool.query<RubricRow>(
      `SELECT * FROM rubrics
       WHERE teacher_id = $1 AND (course_id = $2 OR course_id IS NULL)
       ORDER BY is_default DESC, created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toRubric)
  }
  const { rows } = await pool.query<RubricRow>(
    'SELECT * FROM rubrics WHERE teacher_id = $1 ORDER BY is_default DESC, created_at DESC',
    [teacherId]
  )
  return rows.map(toRubric)
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
  data: { name: string; course_id?: string; criteria: RubricCriterion[]; is_default?: boolean }
): Promise<Rubric> {
  const { rows } = await pool.query<RubricRow>(
    `INSERT INTO rubrics (teacher_id, course_id, name, criteria, is_default)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [teacherId, data.course_id ?? null, data.name, JSON.stringify(data.criteria), data.is_default ?? false]
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
