// pg-boss worker for Кабинет методиста check runs (TODO.md Feature AM,
// Phase 2). Mirrors fosWorker.ts / presentationJobWorker.ts.

import type PgBoss from 'pg-boss'
import { runChecks, type CheckKey } from './checks'
import { findTeacherById } from '../../db/queries/teachers'
import { completeMethodistRun, failMethodistRun, setMethodistRunStatus } from '../../db/queries/methodistRuns'
import { logger } from '../../lib/logger'

export const METHODIST_RUN_QUEUE = 'methodist-run'

export interface RunMethodistChecksParams {
  runId:        string
  teacherId:    string
  programId:    string
  disciplineId: string
  checks:       CheckKey[]
}

const QUEUE_OPTIONS: PgBoss.Queue = {
  name: METHODIST_RUN_QUEUE,
  retryLimit:   1,   // each check already degrades to a per-check error outcome; a queue-level retry is for infra blips, not AI flakiness
  retryDelay:   30,
  retryBackoff: true,
  // Up to 4 checks, each an independent LLM call run in parallel — bounded
  // by the slowest single check, not their sum. Same budget class as the
  // individual routes/programs.ts endpoints (120s each).
  expireInSeconds: 5 * 60,
}

export async function registerMethodistRunWorker(boss: PgBoss): Promise<void> {
  await boss.createQueue(METHODIST_RUN_QUEUE, QUEUE_OPTIONS)

  await boss.work<RunMethodistChecksParams>(
    METHODIST_RUN_QUEUE,
    { includeMetadata: true },
    async ([job]) => {
      const { runId, teacherId, programId, disciplineId, checks } = job.data
      try {
        await setMethodistRunStatus(runId, 'processing')

        const teacher = await findTeacherById(teacherId)
        if (!teacher) throw new Error(`Teacher ${teacherId} not found`)

        const outcomes = await runChecks(
          checks,
          { programId, disciplineId },
          { id: teacher.id, is_platform_admin: teacher.is_platform_admin ?? false, institution_id: teacher.institution_id ?? null }
        )
        await completeMethodistRun(runId, outcomes)
      } catch (err) {
        logger.error({
          message: 'Кабинет методиста run failed', runId,
          attempt: job.retryCount + 1, maxAttempts: job.retryLimit + 1,
          error: (err as Error).message,
        })
        const isLastAttempt = job.retryCount >= job.retryLimit
        if (isLastAttempt) {
          await failMethodistRun(runId, (err as Error).message).catch(() => null)
        }
        throw err
      }
    }
  )
}
