import { pool } from '../connection'
import type { DisciplineCoverageResult, ProgramDocumentReview } from '../../../../shared/types'

interface ReviewRow {
  id:            string
  program_id:    string
  discipline_id: string | null
  document_id:   string
  result:        DisciplineCoverageResult
  created_at:    Date
}

function toReview(r: ReviewRow): ProgramDocumentReview {
  return {
    id:            r.id,
    program_id:    r.program_id,
    discipline_id: r.discipline_id,
    document_id:   r.document_id,
    result:        r.result,
    created_at:    r.created_at.toISOString(),
  }
}

export async function insertReview(data: {
  programId:    string
  disciplineId: string | null
  documentId:   string
  result:       DisciplineCoverageResult
}): Promise<ProgramDocumentReview> {
  const { rows } = await pool.query<ReviewRow>(
    `INSERT INTO program_document_reviews (program_id, discipline_id, document_id, result)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.programId, data.disciplineId, data.documentId, JSON.stringify(data.result)]
  )
  return toReview(rows[0])
}

/** Latest review per discipline for a program — powers the Report tab table. */
export async function getLatestReviewByDiscipline(programId: string): Promise<ProgramDocumentReview[]> {
  const { rows } = await pool.query<ReviewRow>(
    `SELECT DISTINCT ON (discipline_id) *
       FROM program_document_reviews
      WHERE program_id = $1 AND discipline_id IS NOT NULL
      ORDER BY discipline_id, created_at DESC`,
    [programId]
  )
  return rows.map(toReview)
}

export async function getLatestReviewForDiscipline(disciplineId: string): Promise<ProgramDocumentReview | null> {
  const { rows } = await pool.query<ReviewRow>(
    `SELECT * FROM program_document_reviews
      WHERE discipline_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [disciplineId]
  )
  return rows[0] ? toReview(rows[0]) : null
}
