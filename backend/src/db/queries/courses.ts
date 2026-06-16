import { pool } from '../connection'
import type { Course, CourseLevel } from '../../../../shared/types'

interface CourseRow {
  id: string
  teacher_id: string
  name: string
  code: string | null
  level: string | null
  syllabus_text: string | null
  share_rag_with_institution: boolean
  created_at: Date
}

function toCourse(row: CourseRow): Course {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    name: row.name,
    code: row.code,
    level: row.level as CourseLevel | null,
    syllabus_text: row.syllabus_text,
    share_rag_with_institution: row.share_rag_with_institution,
    created_at: row.created_at.toISOString(),
  }
}

export async function findCoursesByTeacher(teacherId: string): Promise<Course[]> {
  const { rows } = await pool.query<CourseRow>(
    'SELECT * FROM courses WHERE teacher_id = $1 ORDER BY created_at DESC',
    [teacherId]
  )
  return rows.map(toCourse)
}

export async function findCourseById(id: string, teacherId: string): Promise<Course | null> {
  const { rows } = await pool.query<CourseRow>(
    'SELECT * FROM courses WHERE id = $1 AND teacher_id = $2 LIMIT 1',
    [id, teacherId]
  )
  return rows[0] ? toCourse(rows[0]) : null
}

export async function createCourse(
  teacherId: string,
  data: { name: string; code?: string; level?: string; syllabus_text?: string }
): Promise<Course> {
  const { rows } = await pool.query<CourseRow>(
    `INSERT INTO courses (teacher_id, name, code, level, syllabus_text)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [teacherId, data.name, data.code ?? null, data.level ?? null, data.syllabus_text ?? null]
  )
  return toCourse(rows[0])
}

export async function updateCourse(
  id: string,
  teacherId: string,
  data: {
    name?: string; code?: string; level?: string; syllabus_text?: string
    share_rag_with_institution?: boolean
  }
): Promise<Course | null> {
  const { rows } = await pool.query<CourseRow>(
    `UPDATE courses
     SET name          = COALESCE($3, name),
         code          = COALESCE($4, code),
         level         = COALESCE($5, level),
         syllabus_text = COALESCE($6, syllabus_text),
         share_rag_with_institution = CASE WHEN $7::boolean IS NOT NULL THEN $7 ELSE share_rag_with_institution END
     WHERE id = $1 AND teacher_id = $2
     RETURNING *`,
    [id, teacherId, data.name ?? null, data.code ?? null, data.level ?? null, data.syllabus_text ?? null,
     data.share_rag_with_institution ?? null]
  )
  return rows[0] ? toCourse(rows[0]) : null
}

/** Set a course's syllabus text — used after a syllabus document is extracted. */
export async function setCourseSyllabusText(courseId: string, text: string): Promise<void> {
  await pool.query('UPDATE courses SET syllabus_text = $2 WHERE id = $1', [courseId, text])
}

export async function deleteCourse(id: string, teacherId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM courses WHERE id = $1 AND teacher_id = $2',
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}
