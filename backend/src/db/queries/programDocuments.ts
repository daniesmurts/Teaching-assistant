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
  superseded_at:  Date | null
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
    superseded_at: r.superseded_at ? r.superseded_at.toISOString() : null,
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

/**
 * All documents attached to a programme, INCLUDING superseded
 * working_programme rows (migration 084) — the caller distinguishes current
 * vs. history via `superseded_at`. This is deliberate: the frontend groups
 * working_programme rows by discipline_id to build the version list/count
 * that gates the year-over-year diff button, without a separate round trip.
 */
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
 * All working_programme documents for a programme, keyed by discipline_id
 * with their extracted text. Bulk equivalent of
 * findWorkingProgrammeForDiscipline — one round trip covers all disciplines.
 * Used by the plan analysis to enrich each discipline's embed input with the
 * uploaded РПД content instead of embedding on the name alone.
 */
export async function listWorkingProgrammesByDiscipline(
  programId: string
): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ discipline_id: string; extracted_text: string | null }>(
    `SELECT discipline_id, extracted_text
       FROM program_documents
      WHERE program_id = $1
        AND kind = 'working_programme'
        AND discipline_id IS NOT NULL
        AND extracted_text IS NOT NULL
        AND superseded_at IS NULL`,
    [programId]
  )
  const out = new Map<string, string>()
  for (const r of rows) if (r.discipline_id && r.extracted_text) out.set(r.discipline_id, r.extracted_text)
  return out
}

/**
 * The current working_programme document for a discipline (if any), with its
 * extracted text — the input for services/documentReview.ts. Migration 051.
 * "Current" = not yet superseded by a later re-upload (migration 084).
 */
export async function findWorkingProgrammeForDiscipline(
  programId: string, disciplineId: string
): Promise<{ document: ProgramDocument; extractedText: string | null } | null> {
  const { rows } = await pool.query<ProgramDocumentRow>(
    `SELECT * FROM program_documents
      WHERE program_id = $1 AND discipline_id = $2 AND kind = 'working_programme'
        AND superseded_at IS NULL
      LIMIT 1`,
    [programId, disciplineId]
  )
  const r = rows[0]
  return r ? { document: toDocument(r), extractedText: r.extracted_text } : null
}

/**
 * Marks the current working_programme row for a discipline as superseded (if
 * any), so a re-upload replaces the "current" pointer without discarding the
 * previous extraction — migration 084, Research.md §9.6 (РПД year-over-year
 * diff needs the old version to compare against). Unlike the hard-delete
 * this replaces, the row and its object-storage file are kept; only
 * kind='working_programme' is versioned this way (practices still hard-
 * replace via deletePracticeForType).
 */
export async function supersedeWorkingProgrammeForDiscipline(
  programId: string, disciplineId: string
): Promise<{ id: string } | null> {
  const { rows } = await pool.query<{ id: string }>(
    `UPDATE program_documents
        SET superseded_at = NOW()
      WHERE program_id = $1 AND discipline_id = $2 AND kind = 'working_programme'
        AND superseded_at IS NULL
      RETURNING id`,
    [programId, disciplineId]
  )
  return rows[0] ? { id: rows[0].id } : null
}

/**
 * All working_programme versions for one discipline (current + superseded),
 * newest upload first, each with its extracted text — the input for the
 * year-over-year diff route: versions[0] is current, versions[1] is what it
 * superseded.
 */
export async function listWorkingProgrammeVersions(
  programId: string, disciplineId: string
): Promise<{ id: string; fileName: string; uploadedAt: string; extractedText: string | null }[]> {
  const { rows } = await pool.query<{ id: string; file_name: string; uploaded_at: Date; extracted_text: string | null }>(
    `SELECT id, file_name, uploaded_at, extracted_text
       FROM program_documents
      WHERE program_id = $1 AND discipline_id = $2 AND kind = 'working_programme'
      ORDER BY uploaded_at DESC`,
    [programId, disciplineId]
  )
  return rows.map((r) => ({
    id:            r.id,
    fileName:      r.file_name,
    uploadedAt:    r.uploaded_at.toISOString(),
    extractedText: r.extracted_text,
  }))
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
