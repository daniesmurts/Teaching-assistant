import { pool } from '../connection'
import type { ProgramDocument, ProgramDocumentKind, ProgramPracticeType } from '../../../../shared/types'

interface ProgramDocumentRow {
  id:            string
  program_id:    string
  kind:          string
  practice_type: string | null
  file_name:     string
  file_size:     number
  mime_type:     string
  storage_path:  string
  uploaded_by:   string | null
  uploaded_at:   Date
}

function toDocument(r: ProgramDocumentRow): ProgramDocument {
  return {
    id:            r.id,
    program_id:    r.program_id,
    kind:          r.kind as ProgramDocumentKind,
    practice_type: r.practice_type as ProgramPracticeType | null,
    file_name:     r.file_name,
    file_size:     r.file_size,
    mime_type:     r.mime_type,
    uploaded_at:   r.uploaded_at.toISOString(),
  }
}

export async function insertProgramDocument(data: {
  programId:    string
  kind:         ProgramDocumentKind
  practiceType: ProgramPracticeType | null
  fileName:     string
  fileSize:     number
  mimeType:     string
  storagePath:  string
  uploadedBy:   string | null
}): Promise<ProgramDocument> {
  const { rows } = await pool.query<ProgramDocumentRow>(
    `INSERT INTO program_documents
       (program_id, kind, practice_type, file_name, file_size, mime_type, storage_path, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [data.programId, data.kind, data.practiceType, data.fileName, data.fileSize,
     data.mimeType, data.storagePath, data.uploadedBy]
  )
  return toDocument(rows[0])
}

export async function listProgramDocuments(programId: string): Promise<ProgramDocument[]> {
  const { rows } = await pool.query<ProgramDocumentRow>(
    `SELECT * FROM program_documents
      WHERE program_id = $1
      ORDER BY kind, practice_type NULLS FIRST, uploaded_at`,
    [programId]
  )
  return rows.map(toDocument)
}

/** Metadata + storage path — for download streaming and delete. */
export async function findProgramDocument(id: string, programId: string): Promise<{
  document:    ProgramDocument
  storagePath: string
} | null> {
  const { rows } = await pool.query<ProgramDocumentRow>(
    `SELECT * FROM program_documents WHERE id = $1 AND program_id = $2 LIMIT 1`,
    [id, programId]
  )
  const r = rows[0]
  return r ? { document: toDocument(r), storagePath: r.storage_path } : null
}

export async function deleteProgramDocument(id: string, programId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM program_documents WHERE id = $1 AND program_id = $2`,
    [id, programId]
  )
  return (rowCount ?? 0) > 0
}
