// pg-boss worker for async presentation generation. Generation used to run
// synchronously inline on the request thread (routes/presentations.ts) —
// fine at low volume, but nothing bounded how many decks could generate at
// once, and a burst (start of semester) risked tying up every open HTTP
// socket + LLM connection simultaneously. Same worker pattern as
// gradeJobWorker.ts: the route enqueues a durable job + a presentation_jobs
// row the client polls.

import type PgBoss from 'pg-boss'
import {
  generatePresentation, planPresentation, expandPresentation, writeMissingNotes,
  renderSlidesAsText, type GenerateParams,
} from './presentations'
import { findPresentationById, replaceSlides } from '../db/queries/presentations'
import {
  getPresentationJobByIdUnscoped, setPresentationJobProcessing,
  setPresentationJobOutlineReady, completePresentationJob, failPresentationJob,
  expireStalePresentationOutlines,
} from '../db/queries/presentationJobs'
import { scheduleWithLease } from './schedulerLease'
import { logger } from '../lib/logger'

export const PRESENTATION_JOB_QUEUE = 'presentation-job'

// Which half of generation this message runs (TODO.md "### AO" Phase 0):
//   'full'    — plan + expand back-to-back, the pre-gate behaviour, still the
//               path when the teacher opts out of reviewing the plan.
//   'outline' — plan only, then park the job at 'outline_ready'.
//   'expand'  — write the deck from the outline stored on the job row.
// A single queue with a stage discriminator rather than two queues: the
// concurrency ceiling that matters is "decks generating at once", and two
// queues would each need their own share of it.
//   'notes'   — fill in speaker notes on an existing deck (an imported .pptx
//               usually arrives with none). Queued rather than inline for the
//               same reason expansion is: sixty slides is twelve LLM calls.
export type PresentationJobStage = 'full' | 'outline' | 'expand' | 'notes'

export interface PresentationJobPayload {
  jobId:  string          // presentation_jobs row id (NOT the pg-boss job id)
  params: GenerateParams  // fully resolved at enqueue time (plan gates already applied)
  stage?: PresentationJobStage   // absent on messages enqueued before the gate shipped — treated as 'full'
  presentationId?: string        // 'notes' only — the deck being filled in
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
        const { jobId, params, stage = 'full', presentationId } = job.data
        const isLastAttempt = job.retryCount >= job.retryLimit
        try {
          // Idempotency guard for the requeue-after-crash path: if a previous
          // attempt already completed the row, don't generate — and bill —
          // again. 'outline_ready' is terminal for the same reason on the
          // outline stage: the plan is already sitting with the teacher, and
          // a retry would silently replace it with a different one.
          const existing = await getPresentationJobByIdUnscoped(jobId)
          if (!existing || existing.status === 'ready') return
          if (stage === 'outline' && existing.status === 'outline_ready') return

          await setPresentationJobProcessing(jobId)

          if (stage === 'outline') {
            const plan = await planPresentation(params)
            await setPresentationJobOutlineReady(jobId, plan.outline, plan.webGrounding)
            return
          }

          if (stage === 'notes') {
            // Notes-only: the slides are the teacher's own work (this deck was
            // usually imported), so nothing here rewrites them.
            if (!presentationId) throw new Error('Не указана презентация')
            const deck = await findPresentationById(presentationId, params.teacherId)
            if (!deck) throw new Error('Презентация не найдена')

            const { slides, filled } = await writeMissingNotes(deck, params)
            if (filled > 0) {
              await replaceSlides(deck.id, params.teacherId, slides, renderSlidesAsText(slides))
            }
            await completePresentationJob(jobId, {
              presentation_id:   deck.id,
              slides,
              generated_content: renderSlidesAsText(slides),
              sources:           deck.sources ?? [],
            })
            return
          }

          if (stage === 'expand') {
            // The outline is read from the row, not the message: it's the
            // teacher's edited version, written by the confirm route after
            // this job's payload was built.
            const outline = existing.outline
            if (!outline || outline.length === 0) {
              throw new Error('Подтверждённый план не найден')
            }
            const result = await expandPresentation(params, {
              outline,
              webGrounding: existing.web_grounding ?? [],
              slideTarget:  params.slideCountTarget ?? outline.length,
            })
            await completePresentationJob(jobId, result)
            return
          }

          const result = await generatePresentation(params)
          await completePresentationJob(jobId, result)
        } catch (err) {
          logger.error({
            message:     'Presentation job failed',
            jobId,
            stage,
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

// ─── Stale-outline sweep ────────────────────────────────────────────────────
//
// A teacher who closes the tab at the approval gate leaves the job parked at
// 'outline_ready' forever, holding their conspectus in `params`. This expires
// those drafts (and clears the stored text with them). Runs through the
// scheduler lease (CLAUDE.md invariant 11) so exactly one instance sweeps,
// whatever the deployment model.
//
// 24h rather than something tight: an outline abandoned over lunch should
// still be there after lunch, and there is nothing expensive about a parked
// row — no LLM call is in flight, no quota is consumed.
const OUTLINE_TTL_HOURS = 24

export function startPresentationOutlineSweeper(): void {
  scheduleWithLease(
    'presentation_outline_sweep',
    { intervalMs: 60 * 60 * 1000, leaseMs: 50 * 60_000, firstRunDelayMs: 3 * 60_000 },
    async () => {
      const expired = await expireStalePresentationOutlines(OUTLINE_TTL_HOURS)
      if (expired > 0) {
        logger.info({ message: 'Expired unconfirmed presentation outlines', count: expired, ttlHours: OUTLINE_TTL_HOURS })
      }
    }
  )
}
