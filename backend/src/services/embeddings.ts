import { embed } from './deepseek'
import { updateEmbedding } from '../db/queries/assignments'

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
    console.error(`Embedding failed for assignment ${assignmentId}:`, err)
  }
}
