import { pool } from '../connection'
import type { DocumentDiffResult, ProgramDocumentDiff } from '../../../../shared/types'

interface DiffRow {
  id:              string
  program_id:      string
  discipline_id:   string
  old_document_id: string
  new_document_id: string
  result:          DocumentDiffResult
  created_at:      Date
}

function toDiff(r: DiffRow): ProgramDocumentDiff {
  return {
    id:              r.id,
    program_id:      r.program_id,
    discipline_id:   r.discipline_id,
    old_document_id: r.old_document_id,
    new_document_id: r.new_document_id,
    result:          r.result,
    created_at:      r.created_at.toISOString(),
  }
}

export async function insertDiff(data: {
  programId:     string
  disciplineId:  string
  oldDocumentId: string
  newDocumentId: string
  result:        DocumentDiffResult
}): Promise<ProgramDocumentDiff> {
  const { rows } = await pool.query<DiffRow>(
    `INSERT INTO program_document_diffs (program_id, discipline_id, old_document_id, new_document_id, result)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.programId, data.disciplineId, data.oldDocumentId, data.newDocumentId, JSON.stringify(data.result)]
  )
  return toDiff(rows[0])
}

/** Cache lookup — a given (old, new) document pair never changes once both are fixed, so a repeat request skips the LLM call. */
export async function findDiff(oldDocumentId: string, newDocumentId: string): Promise<ProgramDocumentDiff | null> {
  const { rows } = await pool.query<DiffRow>(
    `SELECT * FROM program_document_diffs WHERE old_document_id = $1 AND new_document_id = $2 LIMIT 1`,
    [oldDocumentId, newDocumentId]
  )
  return rows[0] ? toDiff(rows[0]) : null
}
