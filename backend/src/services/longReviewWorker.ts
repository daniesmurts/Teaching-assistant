// pg-boss worker for the long-review queue (TODO.md Improvement #1). Wires
// the durable queue (services/jobQueue.ts) to the actual review pipeline
// (services/longReview.ts). Split into its own file so jobQueue.ts stays
// queue-mechanics-only and reusable for future job types (e.g. bulk grading).

import type PgBoss from 'pg-boss'
import { runLongReview, type RunParams } from './longReview'
import { failLongReview } from '../db/queries/longReviews'
import { logger } from '../lib/logger'

export const LONG_REVIEW_QUEUE = 'long-review'

// Retry policy: 2 retries (3 attempts total) with backoff, so a transient
// LLM-provider blip or a PM2 restart mid-job doesn't lose the review outright.
// expireInSeconds is generous — Tier-4/5 passes route through the slow
// reasoner on top of the map-reduce phases, so a large ВКР can legitimately
// run several minutes; this must stay well above that or pg-boss will mark a
// still-running job "expired" and requeue a duplicate attempt.
//
// Deliberately expireInSeconds, not expireInMinutes — verified empirically
// against the installed pg-boss@10.4.2 that createQueue() silently drops
// expireInMinutes/expireInHours (applyExpirationConfig computes `expireIn`
// internally but createQueue's destructuring only reads `expireInSeconds`,
// so the minutes/hours variants never reach the stored queue config and the
// queue falls back to pg-boss's undocumented 15-minute default instead).
const QUEUE_OPTIONS: PgBoss.Queue = {
  name: LONG_REVIEW_QUEUE,
  retryLimit:   2,
  retryDelay:   30,
  retryBackoff: true,
  expireInSeconds: 30 * 60,
}

export async function registerLongReviewWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(LONG_REVIEW_QUEUE, QUEUE_OPTIONS)

  await boss.work<RunParams>(
    LONG_REVIEW_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      const isLastAttempt = job.retryCount >= job.retryLimit
      try {
        await runLongReview(job.data)
      } catch (err) {
        logger.error({
          message:    'Long review job failed',
          reviewId:   job.data.reviewId,
          attempt:    job.retryCount + 1,
          maxAttempts: job.retryLimit + 1,
          error:      (err as Error).message,
        })
        // Only surface a terminal failure to the teacher once retries are
        // exhausted — otherwise the UI would flash "failed" moments before a
        // silent, automatic retry picks it back up.
        if (isLastAttempt) {
          await failLongReview(job.data.reviewId, (err as Error).message).catch(() => null)
        }
        throw err   // rethrow — this is what tells pg-boss the attempt failed
      }
    }
  )
}
