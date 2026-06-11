import { pool } from '../connection'
import type { DocumentChunk } from '../../services/chunker'

export async function createChunk(
  chunk: DocumentChunk,
  embedding: number[]
): Promise<void> {
  await pool.query(
    `INSERT INTO document_chunks
       (document_id, course_id, chunk_index, chunk_type, text, token_estimate,
        embedding, page_start, page_end)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      chunk.documentId, chunk.courseId, chunk.chunkIndex, chunk.chunkType,
      chunk.text, chunk.tokenEstimate, `[${embedding.join(',')}]`,
      chunk.pageStart, chunk.pageEnd,
    ]
  )
}

export async function countChunksForDocument(documentId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::text AS count FROM document_chunks WHERE document_id = $1',
    [documentId]
  )
  return parseInt(rows[0].count, 10)
}

export interface RelevantChunk {
  document_id: string
  file_name:   string
  chunk_index: number
  chunk_type:  string
  text:        string
  page_start:  number | null
  page_end:    number | null
}

/**
 * Retrieve the most semantically similar chunks for a course. JOINs documents
 * to surface file_name so the citation rendered next to a slide can name the
 * source (e.g. «Программа курса.pdf · стр. 4–5»).
 */
export async function findRelevantChunks(
  courseId: string,
  embedding: number[],
  limit = 5
): Promise<RelevantChunk[]> {
  const { rows } = await pool.query<RelevantChunk>(
    `SELECT c.document_id, d.file_name, c.chunk_index, c.chunk_type, c.text,
            c.page_start, c.page_end
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.course_id = $1 AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2
      LIMIT $3`,
    [courseId, `[${embedding.join(',')}]`, limit]
  )
  return rows
}
