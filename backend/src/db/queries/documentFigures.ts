import { pool } from '../connection'
import type { RagRetrievalScope } from '../../services/ragScope'
import type { DocumentVisibilityScope } from './chunks'

export interface DocumentFigureRow {
  id:           string
  document_id:  string
  figure_index: number
  storage_path: string
  mime_type:    string
  ocr_text:     string | null
  caption:      string | null
  width:        number | null
  height:       number | null
}

export async function createFigure(data: {
  documentId:      string
  figureIndex:     number
  storagePath:     string
  mimeType:        string
  ocrText:         string
  caption:         string
  embedding:       number[]
  width?:          number | null
  height?:         number | null
  visibilityScope: DocumentVisibilityScope
  scopeUnitId:     string | null
}): Promise<DocumentFigureRow> {
  const { rows } = await pool.query<DocumentFigureRow>(
    `INSERT INTO document_figures
       (document_id, figure_index, storage_path, mime_type, ocr_text, caption,
        caption_embedding, width, height, visibility_scope, scope_unit_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, document_id, figure_index, storage_path, mime_type, ocr_text, caption, width, height`,
    [
      data.documentId, data.figureIndex, data.storagePath, data.mimeType,
      data.ocrText, data.caption, `[${data.embedding.join(',')}]`,
      data.width ?? null, data.height ?? null, data.visibilityScope, data.scopeUnitId,
    ]
  )
  return rows[0]
}

export async function getFigureById(id: string): Promise<DocumentFigureRow | null> {
  const { rows } = await pool.query<DocumentFigureRow>(
    `SELECT id, document_id, figure_index, storage_path, mime_type, ocr_text, caption, width, height
       FROM document_figures WHERE id = $1 LIMIT 1`,
    [id]
  )
  return rows[0] ?? null
}

export interface RelevantFigure extends DocumentFigureRow {
  file_name:    string
  source_scope: DocumentVisibilityScope
  distance:     number   // cosine distance (embedding <=> query) — 0 = identical, larger = less similar
}

const SCOPE_WHERE_FIGURES = `
  f.caption_embedding IS NOT NULL AND (
       (f.visibility_scope = 'course' AND d.course_id = $1)
    OR (f.visibility_scope = 'unit' AND $4::text IS NOT NULL
          AND EXISTS (SELECT 1 FROM org_units u WHERE u.id = f.scope_unit_id AND $4::text LIKE u.path || '%'))
    OR (f.visibility_scope = 'institution' AND $5::boolean
          AND d.teacher_id IN (SELECT id FROM teachers WHERE institution_id = $6::uuid))
    OR (f.visibility_scope = 'platform')
  )`

/**
 * Mirrors db/queries/chunks.ts's findRelevantChunks shape and scope
 * resolution (Feature AN Phase 2) — top matches by caption-embedding cosine
 * similarity, within the resolved RAG scope. No own-course-first split like
 * chunks has: figures are comparatively rare, so simple top-N by distance is
 * fine — a course rarely has enough of its own figures to fill the slots
 * pooled material would otherwise take.
 */
export async function findRelevantFigures(
  scope: RagRetrievalScope,
  embedding: number[],
  limit = 3
): Promise<RelevantFigure[]> {
  const { rows } = await pool.query<RelevantFigure>(
    `SELECT f.id, f.document_id, f.figure_index, f.storage_path, f.mime_type,
            f.ocr_text, f.caption, f.width, f.height, d.file_name, f.visibility_scope AS source_scope,
            (f.caption_embedding <=> $2) AS distance
       FROM document_figures f
       JOIN documents d ON d.id = f.document_id
      WHERE ${SCOPE_WHERE_FIGURES}
      ORDER BY f.caption_embedding <=> $2
      LIMIT $3`,
    [scope.courseId, `[${embedding.join(',')}]`, limit, scope.unitPath, scope.institutionPoolEnabled, scope.institutionId]
  )
  return rows
}
