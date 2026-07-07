import { embed } from './deepseek'
import { updateEmbedding } from '../db/queries/assignments'
import { insertCriterionExample } from '../db/queries/criterionExamples'
import { logger } from '../lib/logger'
import type { CriterionScore } from '../../../shared/types'

/**
 * Generate an embedding for the given text and store it on the assignment.
 * Called fire-and-forget after approval — never awaited by the caller.
 */
export async function generateAndStoreEmbedding(
  assignmentId: string,
  text: string
): Promise<void> {
  try {
    const vector = await embed(text)
    await updateEmbedding(assignmentId, vector)
  } catch (err) {
    // Non-fatal — RAG will just miss this example until a retry
    logger.warn({ message: 'Embedding failed', assignmentId, error: (err as Error).message })
  }
}

const MIN_CRITERION_FEEDBACK_LENGTH = 15

// Same weight-suffix strip as normaliseCriteriaScores in grading.ts — keeps
// names comparable across assignments (criteria are ephemeral per-assignment
// snapshots, matched by name, not by a stable id).
function normaliseCriterionName(name: string): string {
  return name.replace(/\s*\(вес:?\s*\d+\s*%?\)\s*$/i, '').trim()
}

/**
 * Embed + store each criterion's approved feedback as its own RAG example
 * (TODO Improvement #9 — criterion-level retrieval). Fire-and-forget, called
 * alongside generateAndStoreEmbedding after approval. Skips trivially short
 * feedback (noise like "хорошо") and lets one criterion's embed failure not
 * block the rest.
 */
export async function generateCriterionEmbeddings(
  assignmentId: string,
  teacherId: string,
  courseId: string,
  criteriaScores: CriterionScore[]
): Promise<void> {
  for (const c of criteriaScores) {
    const feedback = c.feedback?.trim() ?? ''
    if (feedback.length < MIN_CRITERION_FEEDBACK_LENGTH) continue
    try {
      const vector = await embed(feedback, { teacherId, feature: 'embedding' })
      await insertCriterionExample({
        assignmentId,
        teacherId,
        courseId,
        criterionName: normaliseCriterionName(c.name),
        score:         c.score,
        feedback,
        embedding:     vector,
      })
    } catch (err) {
      logger.warn({
        message:   'Criterion embedding failed',
        assignmentId,
        criterion: c.name,
        error:     (err as Error).message,
      })
    }
  }
}
