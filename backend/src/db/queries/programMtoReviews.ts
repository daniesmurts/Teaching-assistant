import { pool } from '../connection'
import type { MtoReviewResult, ProgramMtoReview } from '../../../../shared/types'

// Mirrors programPlacementReviews.ts exactly — one row per run, latest per
// discipline_id read by the UI. See migration 101.

interface MtoReviewRow {
  id:            string
  program_id:    string
  discipline_id: string
  document_id:   string
  result:        MtoReviewResult
  created_at:    Date
}

function toReview(r: MtoReviewRow): ProgramMtoReview {
  return {
    id:            r.id,
    program_id:    r.program_id,
    discipline_id: r.discipline_id,
    document_id:   r.document_id,
    result:        r.result,
    created_at:    r.created_at.toISOString(),
  }
}

export async function insertMtoReview(data: {
  programId:    string
  disciplineId: string
  documentId:   string
  result:       MtoReviewResult
}): Promise<ProgramMtoReview> {
  const { rows } = await pool.query<MtoReviewRow>(
    `INSERT INTO program_mto_reviews (program_id, discipline_id, document_id, result)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.programId, data.disciplineId, data.documentId, JSON.stringify(data.result)]
  )
  return toReview(rows[0])
}

export async function getLatestMtoReviewsByProgram(programId: string): Promise<ProgramMtoReview[]> {
  const { rows } = await pool.query<MtoReviewRow>(
    `SELECT DISTINCT ON (discipline_id) *
       FROM program_mto_reviews
      WHERE program_id = $1
      ORDER BY discipline_id, created_at DESC`,
    [programId]
  )
  return rows.map(toReview)
}
