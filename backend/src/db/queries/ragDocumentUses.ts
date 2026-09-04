import { pool } from '../connection'
import { logger } from '../../lib/logger'
import type { RelevantChunk } from './chunks'

// Feature AN Phase 0/3 — logs which pooled document chunks a generation
// actually retrieved, so Phase 3 can surface "used N times outside your own
// course" back to the contributing teacher. Fire-and-forget, same posture as
// the rest of this codebase's usage logging (yandexVision.ts's
// logVisionUsage, llm/yandex.ts's logYandexEmbedUsage) — a logging failure
// must never fail the actual generation request.

export async function logDocumentRetrievals(
  chunks: RelevantChunk[],
  retrievingCourseId: string,
  retrievingTeacherId: string
): Promise<void> {
  const rows = chunks.filter((c) => c.source_scope) // defensive — older mocked chunks in tests may omit it
  if (rows.length === 0) return
  try {
    const values: string[] = []
    const params: unknown[] = []
    rows.forEach((c, i) => {
      const base = i * 4
      values.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`)
      params.push(c.document_id, retrievingCourseId, retrievingTeacherId, c.source_scope !== 'course')
    })
    await pool.query(
      `INSERT INTO rag_document_uses
         (document_id, retrieving_course_id, retrieving_teacher_id, cross_scope)
       VALUES ${values.join(',')}`,
      params
    )
  } catch (err) {
    logger.warn({ message: 'Could not log document RAG retrievals', error: (err as Error).message })
  }
}
