import { pool } from '../connection'
import type { DocumentChunk } from '../../services/chunker'

export async function createChunk(
  chunk: DocumentChunk,
  embedding: number[]
): Promise<void> {
  await pool.query(
    `INSERT INTO document_chunks
       (document_id, course_id, chunk_index, chunk_type, text, token_estimate, embedding)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      chunk.documentId, chunk.courseId, chunk.chunkIndex, chunk.chunkType,
      chunk.text, chunk.tokenEstimate, `[${embedding.join(',')}]`,
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
  text:       string
  chunk_type: string
}

/** Retrieve the most relevant syllabus/material chunks for a course at query time. */
export async function findRelevantChunks(
  courseId: string,
  embedding: number[],
  limit = 5
): Promise<RelevantChunk[]> {
  const { rows } = await pool.query<RelevantChunk>(
    `SELECT text, chunk_type
     FROM document_chunks
     WHERE course_id = $1 AND embedding IS NOT NULL
     ORDER BY embedding <=> $2
     LIMIT $3`,
    [courseId, `[${embedding.join(',')}]`, limit]
  )
  return rows
}
