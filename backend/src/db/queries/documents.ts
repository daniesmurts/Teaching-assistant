import { pool } from '../connection'

export type DocumentType   = 'assignment' | 'syllabus' | 'material'
export type ProcessingStatus = 'pending' | 'extracting' | 'chunking' | 'ready' | 'failed'

// Feature AN Phase 0/1 (TODO.md "### AN") — the scope ladder a document can
// be promoted along, and the provenance attestation required above 'course'.
// 'platform' exists as a stored value (curated ИСПУМ content) but is never
// reachable through the promotion route — see routes/documents.ts.
export type DocumentVisibilityScope = 'course' | 'unit' | 'institution' | 'platform'
export type DocumentProvenance = 'own_work' | 'open_licence' | 'institution_owned' | 'unknown'

export interface DocumentRow {
  id:                string
  teacher_id:        string
  course_id:         string | null
  file_name:         string
  file_type:         string
  mime_type:         string
  file_size_bytes:   number | null
  storage_path:      string
  document_type:     DocumentType
  extracted_text:    string | null
  extraction_method: string | null
  token_estimate:    number | null
  page_count:        number | null
  processing_status: ProcessingStatus
  error_message:     string | null
  visibility_scope:  DocumentVisibilityScope
  scope_unit_id:     string | null
  provenance:        DocumentProvenance
  created_at:        Date
}

export async function createDocument(data: {
  teacherId:     string
  courseId?:     string | null
  fileName:      string
  fileType:      string
  mimeType:      string
  fileSizeBytes: number
  storagePath:   string
  documentType:  DocumentType
}): Promise<DocumentRow> {
  const { rows } = await pool.query<DocumentRow>(
    `INSERT INTO documents
       (teacher_id, course_id, file_name, file_type, mime_type,
        file_size_bytes, storage_path, document_type, processing_status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending')
     RETURNING *`,
    [
      data.teacherId, data.courseId ?? null, data.fileName, data.fileType,
      data.mimeType, data.fileSizeBytes, data.storagePath, data.documentType,
    ]
  )
  return rows[0]
}

export async function getDocumentById(id: string): Promise<DocumentRow | null> {
  const { rows } = await pool.query<DocumentRow>(
    'SELECT * FROM documents WHERE id = $1 LIMIT 1',
    [id]
  )
  return rows[0] ?? null
}

/**
 * A teacher's own documents for a course — backs the "Материалы предмета"
 * list (frontend/src/components/courses/CourseMaterials.tsx). Scoped to the
 * requesting teacher's own uploads, same posture as every other
 * teacher-facing list in this codebase — sharing (Feature AN) surfaces
 * OTHER teachers' materials separately, through the institution library,
 * never mixed into this "what did I upload" view.
 */
export async function listDocumentsForCourse(
  courseId: string,
  teacherId: string,
  documentType?: DocumentType
): Promise<DocumentRow[]> {
  const { rows } = await pool.query<DocumentRow>(
    `SELECT * FROM documents
      WHERE course_id = $1 AND teacher_id = $2 ${documentType ? 'AND document_type = $3' : ''}
      ORDER BY created_at DESC`,
    documentType ? [courseId, teacherId, documentType] : [courseId, teacherId]
  )
  return rows
}

/**
 * Deletes a document row (only if owned by teacherId) and returns its
 * storage_path so the caller can best-effort clean up the object-storage
 * file too. document_chunks/document_figures cascade via their own FKs
 * (ON DELETE CASCADE, migrations 004/117) — no separate cleanup needed here.
 */
export async function deleteDocumentOwnedByTeacher(id: string, teacherId: string): Promise<string | null> {
  const { rows } = await pool.query<{ storage_path: string }>(
    `DELETE FROM documents WHERE id = $1 AND teacher_id = $2 RETURNING storage_path`,
    [id, teacherId]
  )
  return rows[0]?.storage_path ?? null
}

/** All object-storage keys for a teacher's uploads (to wipe files on account deletion). */
export async function getStoragePathsByTeacher(teacherId: string): Promise<string[]> {
  const { rows } = await pool.query<{ storage_path: string }>(
    'SELECT storage_path FROM documents WHERE teacher_id = $1',
    [teacherId]
  )
  return rows.map((r) => r.storage_path)
}

export async function setDocumentStatus(id: string, status: ProcessingStatus): Promise<void> {
  await pool.query('UPDATE documents SET processing_status = $2 WHERE id = $1', [id, status])
}

export async function setDocumentFailed(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE documents SET processing_status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}

/**
 * Latest ready knowledge-document text for a course (syllabus/material), scoped
 * to the owning teacher. Used by the curriculum overlap analysis as a content
 * source when a course has no inline syllabus_text.
 */
export async function getLatestKnowledgeText(
  courseId: string,
  teacherId: string
): Promise<string | null> {
  const { rows } = await pool.query<{ extracted_text: string | null }>(
    `SELECT extracted_text FROM documents
      WHERE course_id = $1 AND teacher_id = $2
        AND document_type IN ('syllabus','material')
        AND processing_status = 'ready'
        AND extracted_text IS NOT NULL
      ORDER BY created_at DESC
      LIMIT 1`,
    [courseId, teacherId]
  )
  return rows[0]?.extracted_text ?? null
}

export async function updateDocumentExtraction(id: string, data: {
  extractedText:    string
  extractionMethod: string
  tokenEstimate:    number
  pageCount?:       number
}): Promise<void> {
  await pool.query(
    `UPDATE documents
     SET extracted_text = $2, extraction_method = $3, token_estimate = $4, page_count = $5
     WHERE id = $1`,
    [id, data.extractedText, data.extractionMethod, data.tokenEstimate, data.pageCount ?? null]
  )
}

// ─── Feature AN — scope promotion + library listing ────────────────────────

/**
 * Promotes a document (and cascades onto its already-created chunks — see
 * db/queries/chunks.ts) to a wider RAG scope. Authorization (requireDomain
 * 'umu'/'edit' on scope_unit_id, or institution-root + plan gate for
 * 'institution') happens in routes/documents.ts before this is called —
 * this function trusts its caller.
 */
export async function promoteDocumentScope(
  id: string,
  data: { visibilityScope: DocumentVisibilityScope; scopeUnitId: string | null; provenance: DocumentProvenance }
): Promise<DocumentRow | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const { rows } = await client.query<DocumentRow>(
      `UPDATE documents
          SET visibility_scope = $2, scope_unit_id = $3, provenance = $4
        WHERE id = $1
      RETURNING *`,
      [id, data.visibilityScope, data.scopeUnitId, data.provenance]
    )
    // Cascade onto chunks already created for this document — retrieval
    // reads the denormalized columns on document_chunks (see chunks.ts), so
    // a promotion that didn't cascade here would silently not take effect
    // until the document was re-uploaded.
    await client.query(
      `UPDATE document_chunks SET visibility_scope = $2, scope_unit_id = $3 WHERE document_id = $1`,
      [id, data.visibilityScope, data.scopeUnitId]
    )
    await client.query('COMMIT')
    return rows[0] ?? null
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export interface LibraryDocumentRow {
  id:                string
  file_name:         string
  teacher_id:        string
  teacher_name:      string | null
  course_id:         string | null
  course_name:       string | null
  document_type:     DocumentType
  visibility_scope:  DocumentVisibilityScope
  scope_unit_id:     string | null
  provenance:        DocumentProvenance
  created_at:        Date
  reuse_count:       number
}

/**
 * Feature AN Phase 3 — how many times a document's chunks/figures were
 * retrieved by a course other than its own (cross_scope = TRUE in
 * rag_document_uses). Surfaced back to the contributing teacher — "ваш
 * материал использован N раз" — as the incentive signal for contributing
 * (reuse count, deliberately not ratings/karma, see TODO.md "### AN").
 */
export async function getDocumentReuseCount(documentId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM rag_document_uses WHERE document_id = $1 AND cross_scope = TRUE`,
    [documentId]
  )
  return parseInt(rows[0]?.count ?? '0', 10)
}

/**
 * Shared/promoted documents visible within an institution, optionally
 * restricted to a subtree (same `pathPrefixes` shape routes/institution.ts's
 * resolveTeachingPrefixes produces — undefined/empty = unrestricted). Backs
 * GET /api/institution/library (Phase 1) and its reuse counts (Phase 3).
 */
export async function listLibraryDocuments(
  institutionId: string,
  pathPrefixes?: string[]
): Promise<LibraryDocumentRow[]> {
  const params: unknown[] = [institutionId]
  let unitFilter = ''
  if (pathPrefixes && pathPrefixes.length > 0) {
    params.push(pathPrefixes)
    // institution-scope docs (no scope_unit_id) are always visible to anyone
    // with umu:view somewhere — unit-scope docs are filtered to the caller's subtree.
    unitFilter = `AND (u.path IS NULL OR EXISTS (
      SELECT 1 FROM unnest($2::text[]) AS prefix WHERE u.path LIKE prefix || '%'
    ))`
  }
  const { rows } = await pool.query<LibraryDocumentRow>(
    `SELECT d.id, d.file_name, d.teacher_id, t.name AS teacher_name,
            d.course_id, c.name AS course_name, d.document_type,
            d.visibility_scope, d.scope_unit_id, d.provenance, d.created_at,
            COALESCE(uses.reuse_count, 0)::int AS reuse_count
       FROM documents d
       JOIN teachers t ON t.id = d.teacher_id
       LEFT JOIN courses c ON c.id = d.course_id
       LEFT JOIN org_units u ON u.id = d.scope_unit_id
       LEFT JOIN (
         SELECT document_id, COUNT(*) AS reuse_count
           FROM rag_document_uses
          WHERE cross_scope = TRUE
          GROUP BY document_id
       ) uses ON uses.document_id = d.id
      WHERE t.institution_id = $1
        AND d.visibility_scope IN ('unit', 'institution')
        ${unitFilter}
      ORDER BY d.created_at DESC`,
    params
  )
  return rows
}
