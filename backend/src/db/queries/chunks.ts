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

/**
 * Deletes chunks belonging to every OTHER 'syllabus'-type document on this
 * course (TODO.md #5 — document re-ingestion lifecycle). A course's syllabus
 * is single-source-of-truth by existing design (`courses.syllabus_text` is
 * one column, always overwritten by the latest upload — see
 * `setCourseSyllabusText`); this makes RAG retrieval follow the same
 * semantic instead of silently mixing an old syllabus's chunks into results
 * alongside the new one forever. Scoped to 'syllabus' only — 'material'
 * documents are intentionally cumulative (a course can have many distinct
 * reading-list docs) and are left untouched.
 *
 * Safe to call after already-generated presentations/quizzes exist: their
 * citations are text snapshots captured at generation time, not live FKs
 * into document_chunks, so deleting old chunks doesn't corrupt history —
 * it only stops them from being retrieved for *future* generations.
 */
export async function deleteChunksForOtherSyllabusDocuments(
  courseId: string,
  keepDocumentId: string
): Promise<number> {
  const { rowCount } = await pool.query(
    `DELETE FROM document_chunks
       WHERE course_id = $1
         AND document_id IN (
           SELECT id FROM documents
            WHERE course_id = $1 AND document_type = 'syllabus' AND id != $2
         )`,
    [courseId, keepDocumentId]
  )
  return rowCount ?? 0
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

export interface ScoredChunk extends RelevantChunk {
  distance: number   // cosine distance (embedding <=> query) — 0 = identical, larger = less similar
}

/**
 * Twin of findRelevantChunks that also surfaces the cosine distance, so a
 * caller can refuse to answer when even the best match is a poor one — the
 * "Спроси документ" grounded-chat feature's non-negotiable requirement
 * (Research/TODO Feature I) that a weak/no match must not fall back to the
 * model's general knowledge.
 */
export async function findRelevantChunksScored(
  courseId: string,
  embedding: number[],
  limit = 5
): Promise<ScoredChunk[]> {
  const { rows } = await pool.query<ScoredChunk>(
    `SELECT c.document_id, d.file_name, c.chunk_index, c.chunk_type, c.text,
            c.page_start, c.page_end, (c.embedding <=> $2) AS distance
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.course_id = $1 AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2
      LIMIT $3`,
    [courseId, `[${embedding.join(',')}]`, limit]
  )
  return rows
}
