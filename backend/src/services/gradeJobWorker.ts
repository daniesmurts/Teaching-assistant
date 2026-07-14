// pg-boss worker for async single-pass grading. Regular grading used to be a
// synchronous HTTP request; calc grading chains 2–4 LLM calls through the
// DeepSeek reasoner and can outlive any HTTP timeout (the client's axios cap
// is 120s), so the teacher saw a generic error while the backend finished
// fine. Same worker pattern as longReviewWorker.ts: the route enqueues a
// durable job + a grade_jobs row the client polls.

import type PgBoss from 'pg-boss'
import { grade, type GradeParams } from './grading'
import {
  getGradeJobByIdUnscoped, setGradeJobProcessing, completeGradeJob, failGradeJob,
} from '../db/queries/gradeJobs'
import { logger } from '../lib/logger'

export const GRADE_JOB_QUEUE = 'grade-job'

export interface GradeJobPayload {
  jobId: string          // grade_jobs row id (NOT the pg-boss job id)
  params: GradeParams    // fully resolved at enqueue time (plan gates already applied)
}

// Retry policy: a single retry (2 attempts). A grade costs real LLM money and
// grade() persists the assignment before the job row is marked ready — a
// crash in that window would re-grade on retry and duplicate the assignment,
// so we keep the retry budget minimal (it exists for transient provider
// blips and PM2 restarts mid-job, the failure this queue was built for).
// expireInSeconds must stay above the worst-case reasoner chain (see
// longReviewWorker.ts for why expireInSeconds and not expireInMinutes).
const QUEUE_OPTIONS: PgBoss.Queue = {
  name: GRADE_JOB_QUEUE,
  retryLimit:   1,
  retryDelay:   15,
  retryBackoff: true,
  expireInSeconds: 15 * 60,
}

export async function registerGradeJobWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(GRADE_JOB_QUEUE, QUEUE_OPTIONS)

  await boss.work<GradeJobPayload>(
    GRADE_JOB_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      const { jobId, params } = job.data
      const isLastAttempt = job.retryCount >= job.retryLimit
      try {
        // Idempotency guard for the requeue-after-crash path: if a previous
        // attempt already completed the row (crash landed between the DB
        // update and pg-boss's ack), don't grade — and bill — again.
        const existing = await getGradeJobByIdUnscoped(jobId)
        if (!existing || existing.status === 'ready') return

        await setGradeJobProcessing(jobId)
        const result = await grade(params)
        await completeGradeJob(jobId, result, result.assignment_id)
      } catch (err) {
        logger.error({
          message:     'Grade job failed',
          jobId,
          attempt:     job.retryCount + 1,
          maxAttempts: job.retryLimit + 1,
          error:       (err as Error).message,
        })
        // Same policy as long reviews: only surface a terminal failure once
        // retries are exhausted, so the UI doesn't flash "failed" right
        // before a silent retry succeeds.
        if (isLastAttempt) {
          await failGradeJob(jobId, (err as Error).message).catch(() => null)
        }
        throw err   // rethrow — this is what tells pg-boss the attempt failed
      }
    }
  )
}
