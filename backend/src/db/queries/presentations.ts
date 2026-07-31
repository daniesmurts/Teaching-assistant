import { pool } from '../connection'
import type {
  Presentation,
  PresentationStyle,
  PresentationSource,
  Slide,
  SlideImage,
} from '../../../../shared/types'

interface PresentationRow {
  id: string
  teacher_id: string
  course_id: string | null
  // Only present when the query joins courses (findPresentationsByTeacher /
  // findPresentationById) — absent (undefined) on plain `RETURNING *` rows
  // from create/update, which toPresentation() maps to null.
  course_name?: string | null
  lecture_number: number | null
  topic: string
  duration_minutes: number | null
  audience_level: string | null
  learning_goals: string[] | null
  style: string | null
  slide_count_target: number | null
  slides: Slide[] | null
  generated_content: string | null
  sources: PresentationSource[] | null
  created_at: Date
}

function toPresentation(row: PresentationRow): Presentation {
  return {
    id: row.id,
    teacher_id: row.teacher_id,
    course_id: row.course_id,
    course_name: row.course_name ?? null,
    lecture_number: row.lecture_number,
    topic: row.topic,
    duration_minutes: row.duration_minutes,
    audience_level: row.audience_level,
    learning_goals: row.learning_goals,
    style: row.style as PresentationStyle | null,
    slide_count_target: row.slide_count_target,
    slides: row.slides,
    generated_content: row.generated_content,
    sources: row.sources,
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
  slides?: Slide[]
  sources?: PresentationSource[]
}): Promise<Presentation> {
  const { rows } = await pool.query<PresentationRow>(
    `INSERT INTO presentations
       (teacher_id, course_id, lecture_number, topic, duration_minutes,
        audience_level, learning_goals, style, slide_count_target,
        generated_content, slides, sources)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
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
      data.slides && data.slides.length > 0 ? JSON.stringify(data.slides) : null,
      data.sources && data.sources.length > 0 ? JSON.stringify(data.sources) : null,
    ]
  )
  return toPresentation(rows[0])
}

// Replace a single slide's image (used by the picker UI). Returns the updated
// presentation or null if the id/teacher/idx combo doesn't match. We update
// the whole `slides` array in one shot — there's no concurrent writer per
// presentation so optimistic overwrite is fine.
export async function setSlideImage(
  id: string,
  teacherId: string,
  slideIdx: number,
  image: SlideImage | null
): Promise<Presentation | null> {
  const existing = await findPresentationById(id, teacherId)
  if (!existing || !existing.slides) return null
  if (slideIdx < 0 || slideIdx >= existing.slides.length) return null

  const slide = existing.slides[slideIdx]
  // Every slide type can carry an image now (TODO.md Feature AG Phase 2) —
  // diagram keeps its own body.image_query/image (see shared/types.ts's
  // SlideBase comment), everything else uses the top-level field. Route
  // already validated the slide actually has a query before calling here;
  // this just decides which of the two locations to write into.
  const next = existing.slides.map((s, i) => {
    if (i !== slideIdx) return s
    return s.type === 'diagram'
      ? { ...s, body: { ...s.body, image } }
      : { ...s, image }
  })

  const { rows } = await pool.query<PresentationRow>(
    `UPDATE presentations
        SET slides = $1
      WHERE id = $2 AND teacher_id = $3
      RETURNING *`,
    [JSON.stringify(next), id, teacherId]
  )
  return rows[0] ? toPresentation(rows[0]) : null
}

export async function findPresentationsByTeacher(
  teacherId: string,
  courseId?: string
): Promise<Presentation[]> {
  if (courseId) {
    const { rows } = await pool.query<PresentationRow>(
      `SELECT p.*, c.name AS course_name
         FROM presentations p
         LEFT JOIN courses c ON c.id = p.course_id
        WHERE p.teacher_id = $1 AND p.course_id = $2
        ORDER BY p.created_at DESC`,
      [teacherId, courseId]
    )
    return rows.map(toPresentation)
  }
  const { rows } = await pool.query<PresentationRow>(
    `SELECT p.*, c.name AS course_name
       FROM presentations p
       LEFT JOIN courses c ON c.id = p.course_id
      WHERE p.teacher_id = $1
      ORDER BY p.created_at DESC`,
    [teacherId]
  )
  return rows.map(toPresentation)
}

export async function findPresentationById(
  id: string,
  teacherId: string
): Promise<Presentation | null> {
  const { rows } = await pool.query<PresentationRow>(
    `SELECT p.*, c.name AS course_name
       FROM presentations p
       LEFT JOIN courses c ON c.id = p.course_id
      WHERE p.id = $1 AND p.teacher_id = $2
      LIMIT 1`,
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
