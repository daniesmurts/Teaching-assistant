import { pool } from '../connection'
import type { SyllabusSection, SyllabusReview } from '../../../../shared/types'
import type { CompetencyInput } from '../../services/syllabusReview'

export interface SyllabusStudioDraftRow {
  course_id:       string
  teacher_id:      string
  discipline_name: string
  sections:        SyllabusSection[]
  competencies:    CompetencyInput[]
  goals:           string[]
  review:          SyllabusReview | null
  updated_at:      string
}

/** One row per course, upserted in place — see migration 070 for the "why". */
export async function saveSyllabusStudioDraft(data: {
  courseId:       string
  teacherId:      string
  disciplineName: string
  sections:       SyllabusSection[]
  competencies:   CompetencyInput[]
  goals:          string[]
  review:         SyllabusReview | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO syllabus_studio_drafts
       (course_id, teacher_id, discipline_name, sections, competencies, goals, review, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, NOW())
     ON CONFLICT (course_id) DO UPDATE SET
       teacher_id      = EXCLUDED.teacher_id,
       discipline_name = EXCLUDED.discipline_name,
       sections        = EXCLUDED.sections,
       competencies    = EXCLUDED.competencies,
       goals           = EXCLUDED.goals,
       review          = EXCLUDED.review,
       updated_at      = NOW()`,
    [
      data.courseId, data.teacherId, data.disciplineName,
      JSON.stringify(data.sections), JSON.stringify(data.competencies), JSON.stringify(data.goals),
      data.review ? JSON.stringify(data.review) : null,
    ]
  )
}

export async function getSyllabusStudioDraft(
  courseId: string,
  teacherId: string
): Promise<SyllabusStudioDraftRow | null> {
  const { rows } = await pool.query<SyllabusStudioDraftRow>(
    `SELECT course_id, teacher_id, discipline_name, sections, competencies, goals, review, updated_at
       FROM syllabus_studio_drafts
      WHERE course_id = $1 AND teacher_id = $2`,
    [courseId, teacherId]
  )
  return rows[0] ?? null
}
