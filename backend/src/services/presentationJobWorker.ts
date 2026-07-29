// pg-boss worker for async presentation generation. Generation used to run
// synchronously inline on the request thread (routes/presentations.ts) —
// fine at low volume, but nothing bounded how many decks could generate at
// once, and a burst (start of semester) risked tying up every open HTTP
// socket + LLM connection simultaneously. Same worker pattern as
// gradeJobWorker.ts: the route enqueues a durable job + a presentation_jobs
// row the client polls.

import type PgBoss from 'pg-boss'
import { generatePresentation, type GenerateParams } from './presentations'
import {
  getPresentationJobByIdUnscoped, setPresentationJobProcessing,
  completePresentationJob, failPresentationJob,
} from '../db/queries/presentationJobs'
import { logger } from '../lib/logger'

export const PRESENTATION_JOB_QUEUE = 'presentation-job'

export interface PresentationJobPayload {
  jobId:  string          // presentation_jobs row id (NOT the pg-boss job id)
  params: GenerateParams  // fully resolved at enqueue time (plan gates already applied)
}

// Retry policy mirrors grade_jobs: one retry, short backoff. generatePresentation
// persists the presentations row itself — a crash after that but before the
// job row updates would otherwise regenerate (and re-bill) on retry, so the
// idempotency guard below is what actually keeps a retry cheap, not the low
// retryLimit alone.
const QUEUE_OPTIONS: PgBoss.Queue = {
  name: PRESENTATION_JOB_QUEUE,
  retryLimit:   1,
  retryDelay:   15,
  retryBackoff: true,
  expireInSeconds: 10 * 60,
}

// pg-boss v10 dropped the old teamSize/teamConcurrency worker options — the
// only way to run more than one job at a time per queue is to register
// boss.work() more than once (each call spins up its own independent polling
// loop). We can't raise batchSize instead: every worker handler in this
// codebase (see gradeJobWorker.ts, fosWorker.ts) destructures the fetched
// batch as `[job]`, i.e. only ever looks at the first element — pg-boss
// still marks the *entire* fetched batch complete once the handler resolves,
// so batchSize > 1 with this handler shape would silently drop the other
// jobs in the batch as "done" without ever running them. Registering N
// independent single-job loops avoids that trap entirely.
//
// 4 per PM2 process × 2 processes = 8 decks generating concurrently
// platform-wide today. Override via PRESENTATION_WORKER_CONCURRENCY when the
// VM is upsized — this is the knob to raise, not batchSize.
const CONCURRENCY = Number(process.env.PRESENTATION_WORKER_CONCURRENCY) || 4

export async function registerPresentationJobWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(PRESENTATION_JOB_QUEUE, QUEUE_OPTIONS)

  for (let i = 0; i < CONCURRENCY; i++) {
    await boss.work<PresentationJobPayload>(
      PRESENTATION_JOB_QUEUE,
      { includeMetadata: true },
      async ([job]) => {
        const { jobId, params } = job.data
        const isLastAttempt = job.retryCount >= job.retryLimit
        try {
          // Idempotency guard for the requeue-after-crash path: if a previous
          // attempt already completed the row, don't generate — and bill —
          // again.
          const existing = await getPresentationJobByIdUnscoped(jobId)
          if (!existing || existing.status === 'ready') return

          await setPresentationJobProcessing(jobId)
          const result = await generatePresentation(params)
          await completePresentationJob(jobId, result)
        } catch (err) {
          logger.error({
            message:     'Presentation job failed',
            jobId,
            attempt:     job.retryCount + 1,
            maxAttempts: job.retryLimit + 1,
            error:       (err as Error).message,
          })
          // Same policy as grade jobs: only surface a terminal failure once
          // retries are exhausted, so the UI doesn't flash "failed" right
          // before a silent retry succeeds.
          if (isLastAttempt) {
            await failPresentationJob(jobId, (err as Error).message).catch(() => null)
          }
          throw err   // rethrow — this is what tells pg-boss the attempt failed
        }
      }
    )
  }
}
