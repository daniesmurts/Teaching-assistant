import { pool } from '../connection'
import type { ProgramDocument, ProgramDocumentKind, ProgramPracticeType } from '../../../../shared/types'

interface ProgramDocumentRow {
  id:             string
  program_id:     string
  kind:           string
  practice_type:  string | null
  discipline_id:  string | null
  file_name:      string
  file_size:      number
  mime_type:      string
  storage_path:   string
  extracted_text: string | null
  uploaded_by:    string | null
  uploaded_at:    Date
}

function toDocument(r: ProgramDocumentRow): ProgramDocument {
  return {
    id:            r.id,
    program_id:    r.program_id,
    kind:          r.kind as ProgramDocumentKind,
    practice_type: r.practice_type as ProgramPracticeType | null,
    discipline_id: r.discipline_id,
    file_name:     r.file_name,
    file_size:     r.file_size,
    mime_type:     r.mime_type,
    uploaded_at:   r.uploaded_at.toISOString(),
  }
}

export async function insertProgramDocument(data: {
  programId:     string
  kind:          ProgramDocumentKind
  practiceType:  ProgramPracticeType | null
  disciplineId:  string | null
  fileName:      string
  fileSize:      number
  mimeType:      string
  storagePath:   string
  extractedText: string | null
  uploadedBy:    string | null
}): Promise<ProgramDocument> {
  const { rows } = await pool.query<ProgramDocumentRow>(
    `INSERT INTO program_documents
       (program_id, kind, practice_type, discipline_id, file_name, file_size, mime_type,
        storage_path, extracted_text, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [data.programId, data.kind, data.practiceType, data.disciplineId, data.fileName, data.fileSize,
     data.mimeType, data.storagePath, data.extractedText, data.uploadedBy]
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

/**
 * The current working_programme document for a discipline (if any), with its
 * extracted text — the input for services/documentReview.ts. Migration 051.
 */
export async function findWorkingProgrammeForDiscipline(
  programId: string, disciplineId: string
): Promise<{ document: ProgramDocument; extractedText: string | null } | null> {
  const { rows } = await pool.query<ProgramDocumentRow>(
    `SELECT * FROM program_documents
      WHERE program_id = $1 AND discipline_id = $2 AND kind = 'working_programme'
      LIMIT 1`,
    [programId, disciplineId]
  )
  const r = rows[0]
  return r ? { document: toDocument(r), extractedText: r.extracted_text } : null
}

/**
 * Deletes the existing working_programme row for a discipline, if any, so a
 * re-upload replaces rather than accumulates. Returns the deleted row's
 * storage path so the caller can best-effort clean up the object — mirrors
 * the cleanup pattern in routes/programs.ts's DELETE /:id/documents/:docId.
 */
export async function deleteWorkingProgrammeForDiscipline(
  programId: string, disciplineId: string
): Promise<{ storagePath: string } | null> {
  const { rows } = await pool.query<{ storage_path: string }>(
    `DELETE FROM program_documents
      WHERE program_id = $1 AND discipline_id = $2 AND kind = 'working_programme'
      RETURNING storage_path`,
    [programId, disciplineId]
  )
  return rows[0] ? { storagePath: rows[0].storage_path } : null
}

/**
 * Deletes the existing practice document of a given type on a programme, if
 * any, so a re-upload replaces rather than accumulates — the FEATURES.md
 * invariant is one file per practice type per programme (enforced by the
 * partial unique index from migration 054; this keeps the happy path a
 * replace instead of a constraint error). Returns the deleted row's storage
 * path for best-effort object cleanup, same as the working_programme twin.
 */
export async function deletePracticeForType(
  programId: string, practiceType: ProgramPracticeType
): Promise<{ storagePath: string } | null> {
  const { rows } = await pool.query<{ storage_path: string }>(
    `DELETE FROM program_documents
      WHERE program_id = $1 AND practice_type = $2 AND kind = 'practice'
      RETURNING storage_path`,
    [programId, practiceType]
  )
  return rows[0] ? { storagePath: rows[0].storage_path } : null
}

export async function deleteProgramDocument(id: string, programId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM program_documents WHERE id = $1 AND program_id = $2`,
    [id, programId]
  )
  return (rowCount ?? 0) > 0
}
