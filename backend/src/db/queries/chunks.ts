import { pool } from '../connection'
import type { DocumentChunk } from '../../services/chunker'
import type { RagRetrievalScope } from '../../services/ragScope'

export async function createChunk(
  chunk: DocumentChunk,
  embedding: number[]
): Promise<void> {
  await pool.query(
    `INSERT INTO document_chunks
       (document_id, course_id, chunk_index, chunk_type, text, token_estimate,
        embedding, page_start, page_end, visibility_scope, scope_unit_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      chunk.documentId, chunk.courseId, chunk.chunkIndex, chunk.chunkType,
      chunk.text, chunk.tokenEstimate, `[${embedding.join(',')}]`,
      chunk.pageStart, chunk.pageEnd,
      chunk.visibilityScope ?? 'course', chunk.scopeUnitId ?? null,
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

export type DocumentVisibilityScope = 'course' | 'unit' | 'institution' | 'platform'

export interface RelevantChunk {
  document_id: string
  file_name:   string
  chunk_index: number
  chunk_type:  string
  text:        string
  page_start:  number | null
  page_end:    number | null
  source_scope: DocumentVisibilityScope
}

// Params: $1 courseId, $2 unitPath, $3 institutionPoolEnabled, $4 institutionId.
// Kept to exactly these four so every caller — including hasAnyChunksForCourse,
// which needs no vector/limit params at all — can bind them without ever
// passing an unused placeholder. An untyped null bound to a $N Postgres never
// sees referenced elsewhere in the query text fails with "could not
// determine data type of parameter $N" (no context to infer from); giving
// SCOPE_WHERE its own fixed, always-referenced param block avoids that by
// construction instead of relying on every caller to remember to cast.
const SCOPE_WHERE = `
  c.embedding IS NOT NULL AND (
       (c.visibility_scope = 'course' AND c.course_id = $1)
    OR (c.visibility_scope = 'unit' AND $2::text IS NOT NULL
          AND EXISTS (SELECT 1 FROM org_units u WHERE u.id = c.scope_unit_id AND $2::text LIKE u.path || '%'))
    OR (c.visibility_scope = 'institution' AND $3::boolean
          AND d.teacher_id IN (SELECT id FROM teachers WHERE institution_id = $4::uuid))
    OR (c.visibility_scope = 'platform')
  )`

function scopeParams(scope: RagRetrievalScope): [string, string | null, boolean, string | null] {
  return [scope.courseId, scope.unitPath, scope.institutionPoolEnabled, scope.institutionId]
}

const SELECT_COLUMNS = `c.document_id, d.file_name, c.chunk_index, c.chunk_type, c.text,
            c.page_start, c.page_end, c.visibility_scope AS source_scope`

/**
 * Retrieve the most semantically similar chunks for a course's resolved RAG
 * scope (Feature AN Phase 0 — own-course + pooled кафедра/institution/
 * platform material, see services/ragScope.ts). JOINs documents to surface
 * file_name so the citation rendered next to a slide can name the source
 * (e.g. «Программа курса.pdf · стр. 4–5»).
 *
 * Own-course chunks are always fetched first and never displaced — pooled
 * chunks only fill slots the course's own material didn't use. This is a
 * deliberate departure from findSimilarAssignments's reserved-quota
 * approach: a teacher's own uploaded material should never be crowded out
 * by кафедра-wide files.
 */
export async function findRelevantChunks(
  scope: RagRetrievalScope,
  embedding: number[],
  limit = 5
): Promise<RelevantChunk[]> {
  const vec = `[${embedding.join(',')}]`
  const { rows: own } = await pool.query<RelevantChunk>(
    `SELECT ${SELECT_COLUMNS}
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.visibility_scope = 'course' AND c.course_id = $1 AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2
      LIMIT $3`,
    [scope.courseId, vec, limit]
  )
  if (own.length >= limit) return own

  const { rows: pooled } = await pool.query<RelevantChunk>(
    `SELECT ${SELECT_COLUMNS}
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.visibility_scope != 'course' AND ${SCOPE_WHERE}
      ORDER BY c.embedding <=> $5
      LIMIT $6`,
    [...scopeParams(scope), vec, limit - own.length]
  )
  return [...own, ...pooled]
}

export interface ScoredChunk extends RelevantChunk {
  distance: number   // cosine distance (embedding <=> query) — 0 = identical, larger = less similar
}

/**
 * Twin of findRelevantChunks that also surfaces the cosine distance, so a
 * caller can refuse to answer when even the best match is a poor one — the
 * "Спроси документ" grounded-chat feature's non-negotiable requirement
 * (Research/TODO Feature I) that a weak/no match must not fall back to the
 * model's general knowledge. Same own-course-first, scope-widened shape as
 * findRelevantChunks.
 */
export async function findRelevantChunksScored(
  scope: RagRetrievalScope,
  embedding: number[],
  limit = 5
): Promise<ScoredChunk[]> {
  const vec = `[${embedding.join(',')}]`
  const { rows: own } = await pool.query<ScoredChunk>(
    `SELECT ${SELECT_COLUMNS}, (c.embedding <=> $2) AS distance
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.visibility_scope = 'course' AND c.course_id = $1 AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> $2
      LIMIT $3`,
    [scope.courseId, vec, limit]
  )
  if (own.length >= limit) return own

  const { rows: pooled } = await pool.query<ScoredChunk>(
    `SELECT ${SELECT_COLUMNS}, (c.embedding <=> $5) AS distance
       FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
      WHERE c.visibility_scope != 'course' AND ${SCOPE_WHERE}
      ORDER BY c.embedding <=> $5
      LIMIT $6`,
    [...scopeParams(scope), vec, limit - own.length]
  )
  return [...own, ...pooled]
}

/**
 * Cheap existence probe (TODO.md Feature AG Phase 3) — no embedding call,
 * just "does this course have anything to retrieve at all". Used to decide
 * whether presentation generation needs web-search grounding instead of RAG.
 * Scope-aware (Feature AN Phase 0): a course with none of its own material
 * but reachable кафедра/institution/platform pooling still counts, so it
 * isn't wrongly routed to web-search grounding.
 */
export async function hasAnyChunksForCourse(scope: RagRetrievalScope): Promise<boolean> {
  const { rows } = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM document_chunks c
       JOIN documents d ON d.id = c.document_id
       WHERE ${SCOPE_WHERE}
     ) AS exists`,
    scopeParams(scope)
  )
  return rows[0]?.exists ?? false
}
