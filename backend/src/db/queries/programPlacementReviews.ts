import { pool } from '../connection'
import type { PlacementReviewResult, ProgramPlacementReview } from '../../../../shared/types'

// Mirrors programDocumentReviews.ts exactly (migration 051 pattern) — one
// row per run, latest per discipline_id read by the UI. See migration 100.

interface PlacementReviewRow {
  id:            string
  program_id:    string
  discipline_id: string
  document_id:   string
  result:        PlacementReviewResult
  created_at:    Date
}

function toReview(r: PlacementReviewRow): ProgramPlacementReview {
  return {
    id:            r.id,
    program_id:    r.program_id,
    discipline_id: r.discipline_id,
    document_id:   r.document_id,
    result:        r.result,
    created_at:    r.created_at.toISOString(),
  }
}

export async function insertPlacementReview(data: {
  programId:    string
  disciplineId: string
  documentId:   string
  result:       PlacementReviewResult
}): Promise<ProgramPlacementReview> {
  const { rows } = await pool.query<PlacementReviewRow>(
    `INSERT INTO program_placement_reviews (program_id, discipline_id, document_id, result)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [data.programId, data.disciplineId, data.documentId, JSON.stringify(data.result)]
  )
  return toReview(rows[0])
}

/** Latest placement review per discipline for a program — powers both the
 *  per-discipline panel and the D3 asymmetry cross-check across disciplines. */
export async function getLatestPlacementReviewsByProgram(programId: string): Promise<ProgramPlacementReview[]> {
  const { rows } = await pool.query<PlacementReviewRow>(
    `SELECT DISTINCT ON (discipline_id) *
       FROM program_placement_reviews
      WHERE program_id = $1
      ORDER BY discipline_id, created_at DESC`,
    [programId]
  )
  return rows.map(toReview)
}
