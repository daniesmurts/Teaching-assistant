import { pool } from '../connection'
import type { TextChunk } from '../../services/chunker'

export type StrategyDocProcessingStatus = 'pending' | 'extracting' | 'chunking' | 'ready' | 'failed'

export interface StrategyDocumentRow {
  id:                string
  institution_id:    string
  file_name:         string
  storage_path:      string
  extracted_text:    string | null
  processing_status: StrategyDocProcessingStatus
  error_message:     string | null
  uploaded_by:       string | null
  uploaded_at:       Date
}

/** institution_id is UNIQUE — a re-upload replaces the prior row (chunks cascade). */
export async function replaceStrategyDocument(data: {
  institutionId: string
  fileName:      string
  storagePath:   string
  uploadedBy:    string
}): Promise<StrategyDocumentRow> {
  await pool.query('DELETE FROM institution_strategy_documents WHERE institution_id = $1', [data.institutionId])
  const { rows } = await pool.query<StrategyDocumentRow>(
    `INSERT INTO institution_strategy_documents
       (institution_id, file_name, storage_path, uploaded_by, processing_status)
     VALUES ($1,$2,$3,$4,'pending')
     RETURNING *`,
    [data.institutionId, data.fileName, data.storagePath, data.uploadedBy]
  )
  return rows[0]
}

export async function getStrategyDocumentByInstitution(institutionId: string): Promise<StrategyDocumentRow | null> {
  const { rows } = await pool.query<StrategyDocumentRow>(
    'SELECT * FROM institution_strategy_documents WHERE institution_id = $1 LIMIT 1',
    [institutionId]
  )
  return rows[0] ?? null
}

export async function deleteStrategyDocument(institutionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM institution_strategy_documents WHERE institution_id = $1',
    [institutionId]
  )
  return (rowCount ?? 0) > 0
}

export async function setStrategyDocumentStatus(id: string, status: StrategyDocProcessingStatus): Promise<void> {
  await pool.query('UPDATE institution_strategy_documents SET processing_status = $2 WHERE id = $1', [id, status])
}

export async function setStrategyDocumentFailed(id: string, message: string): Promise<void> {
  await pool.query(
    `UPDATE institution_strategy_documents SET processing_status = 'failed', error_message = $2 WHERE id = $1`,
    [id, message.slice(0, 500)]
  )
}

export async function setStrategyDocumentExtractedText(id: string, text: string): Promise<void> {
  await pool.query(
    'UPDATE institution_strategy_documents SET extracted_text = $2 WHERE id = $1',
    [id, text]
  )
}

export async function insertStrategyChunk(documentId: string, chunk: TextChunk, embedding: number[]): Promise<void> {
  await pool.query(
    `INSERT INTO institution_strategy_chunks
       (document_id, chunk_index, text, embedding, page_start, page_end)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [documentId, chunk.chunkIndex, chunk.text, `[${embedding.join(',')}]`, chunk.pageStart, chunk.pageEnd]
  )
}

export interface ScoredStrategyChunk {
  document_id: string
  file_name:   string
  text:        string
  page_start:  number | null
  page_end:    number | null
  distance:    number   // cosine distance — 0 = identical, larger = less similar
}

/**
 * Twin of db/queries/chunks.ts's findRelevantChunksScored, joined through
 * institution_strategy_documents instead of filtering by course_id — same
 * "surface the distance so the caller can refuse a weak match" contract
 * docChat.ts relies on (Feature Z Plane-2 reuses the identical
 * UNGROUNDED_DISTANCE gate in routes/programs.ts, not a new heuristic).
 */
export async function findRelevantStrategyChunksScored(
  institutionId: string,
  embedding: number[],
  limit = 3
): Promise<ScoredStrategyChunk[]> {
  const { rows } = await pool.query<ScoredStrategyChunk>(
    `SELECT c.document_id, d.file_name, c.text, c.page_start, c.page_end,
            (c.embedding <=> $2) AS distance
       FROM institution_strategy_chunks c
       JOIN institution_strategy_documents d ON d.id = c.document_id
      WHERE d.institution_id = $1 AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2
      LIMIT $3`,
    [institutionId, `[${embedding.join(',')}]`, limit]
  )
  return rows
}
