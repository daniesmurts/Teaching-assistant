// pg-boss worker for the ФОС-generation queue (TODO.md Feature X). Wires the
// durable queue (services/jobQueue.ts) to the orchestrator
// (services/fosGenerator.ts) — mirrors longReviewWorker.ts exactly.

import type PgBoss from 'pg-boss'
import { runFosGeneration, type RunFosParams } from './fosGenerator'
import { failFosDocument } from '../db/queries/fosDocuments'
import { logger } from '../lib/logger'

export const FOS_QUEUE = 'fos-generation'

// Generous expiry — this chains ~7 sequential LLM calls (quiz, 3x task
// kinds, tickets, criteria, plus the extraction pass), comparable in shape
// to long-review's map-reduce passes. expireInSeconds, not
// expireInMinutes/Hours — pg-boss@10.4.2's createQueue silently drops those
// variants (see longReviewWorker.ts's header comment for the verified detail).
const QUEUE_OPTIONS: PgBoss.Queue = {
  name: FOS_QUEUE,
  retryLimit:   2,
  retryDelay:   30,
  retryBackoff: true,
  expireInSeconds: 20 * 60,
}

export async function registerFosWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(FOS_QUEUE, QUEUE_OPTIONS)

  await boss.work<RunFosParams>(
    FOS_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      const isLastAttempt = job.retryCount >= job.retryLimit
      try {
        await runFosGeneration(job.data)
      } catch (err) {
        logger.error({
          message:    'ФОС generation job failed',
          fosId:      job.data.fosId,
          attempt:    job.retryCount + 1,
          maxAttempts: job.retryLimit + 1,
          error:      (err as Error).message,
        })
        // Only surface a terminal failure once retries are exhausted — same
        // "don't flash failed moments before a silent retry" rule as long-review.
        if (isLastAttempt) {
          await failFosDocument(job.data.fosId, (err as Error).message).catch(() => null)
        }
        throw err
      }
    }
  )
}
