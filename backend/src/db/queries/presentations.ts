import { pool } from '../connection'
import type { Presentation, PresentationStyle } from '../../../../shared/types'

interface PresentationRow {
  id: string
  teacher_id: string
  course_id: string | null
  lecture_number: number | null
  topic: string
  duration_minutes: number | null
  audience_level: string | null
  learning_goals: string[] | null
  style: string | null
  slide_count_target: number | null
  generated_content: string | null
  created_at: Date
}

function toPresentation(row: PresentationRow): Presentation {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    course_id: row.course_id,
    lecture_number: row.lecture_number,
    topic: row.topic,
    duration_minutes: row.duration_minutes,
    audience_level: row.audience_level,
    learning_goals: row.learning_goals,
    style: row.style as PresentationStyle | null,
    slide_count_target: row.slide_count_target,
    generated_content: row.generated_content,
    created_at: row.created_at.toISOString(),
  }
}

export async function createPresentation(data: {
  teacherId: string
  courseId?: string
  lectureNumber?: number
  topic: string
  durationMinutes?: number
  audienceLevel?: string
  learningGoals?: string[]
  style?: string
  slideCountTarget?: number
  generatedContent: string
}): Promise<Presentation> {
  const { rows } = await pool.query<PresentationRow>(
    `INSERT INTO presentations
       (teacher_id, course_id, lecture_number, topic, duration_minutes,
        audience_level, learning_goals, style, slide_count_target, generated_content)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     RETURNING *`,
    [
      data.teacherId,
      data.courseId ?? null,
      data.lectureNumber ?? null,
      data.topic,
      data.durationMinutes ?? null,
      data.audienceLevel ?? null,
      data.learningGoals ?? null,
      data.style ?? null,
      data.slideCountTarget ?? null,
      data.generatedContent,
    ]
  )
  return toPresentation(rows[0])
}

export async function findPresentationsByTeacher(
  teacherId: string,
  courseId?: string
): Promise<Presentation[]> {
  if (courseId) {
    const { rows } = await pool.query<PresentationRow>(
      `SELECT * FROM presentations
       WHERE teacher_id = $1 AND course_id = $2
       ORDER BY created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toPresentation)
  }
  const { rows } = await pool.query<PresentationRow>(
    'SELECT * FROM presentations WHERE teacher_id = $1 ORDER BY created_at DESC',
    [teacherId]
  )
  return rows.map(toPresentation)
}

export async function findPresentationById(
  id: string,
  teacherId: string
): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    'SELECT * FROM presentations WHERE id = $1 AND teacher_id = $2 LIMIT 1',
    [id, teacherId]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

export async function deletePresentation(id: string, teacherId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM presentations WHERE id = $1 AND teacher_id = $2',
    [id, teacherId]
  )
  return (rowCount ?? 0) > 0
}
