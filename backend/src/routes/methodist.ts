import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { createMethodistRunRules, methodistRunIdRules } from '../validation/methodistValidation'
import { loadReadableDiscipline } from '../services/methodist/target'
import { type CheckKey } from '../services/methodist/checks'
import { getJobQueue } from '../services/jobQueue'
import { METHODIST_RUN_QUEUE, type RunMethodistChecksParams } from '../services/methodist/runWorker'
import { createMethodistRun, getMethodistRun, listRecentMethodistRuns } from '../db/queries/methodistRuns'

const router = Router()
router.use(authenticate)

// POST /api/methodist/runs — Кабинет методиста (TODO Feature AM, Phase 2).
// Runs the selected checks for one programme discipline asynchronously
// (pg-boss — up to 4 independent LLM calls, too slow to hold a request
// open for). Target + access validated here, before enqueueing, so a bad
// programme/discipline id or a caller without read access surfaces as an
// immediate 404/403 instead of a run that's queued only to fail.
router.post(
  '/runs',
  aiLimiter,
  validate(createMethodistRunRules),
  asyncHandler(async (req, res) => {
    const { program_id, discipline_id, checks } = req.body as {
      program_id: string; discipline_id: string; checks: CheckKey[]
    }

    await loadReadableDiscipline({ programId: program_id, disciplineId: discipline_id }, req.teacher)

    const run = await createMethodistRun({
      teacherId: req.teacher.id, programId: program_id, disciplineId: discipline_id, checks,
    })

    const jobPayload: RunMethodistChecksParams = {
      runId: run.id, teacherId: req.teacher.id, programId: program_id, disciplineId: discipline_id, checks,
    }
    await getJobQueue().send(METHODIST_RUN_QUEUE, jobPayload)

    res.status(202).json(run)
  })
)

// GET /api/methodist/runs/:id — poll run status / fetch the finished result.
router.get(
  '/runs/:id',
  validate(methodistRunIdRules),
  asyncHandler(async (req, res) => {
    const run = await getMethodistRun(req.params.id, req.teacher.id)
    if (!run) throw new NotFoundError('Проверка')
    res.json(run)
  })
)

// GET /api/methodist/runs — recent run history for this teacher.
router.get(
  '/runs',
  asyncHandler(async (req, res) => {
    res.json(await listRecentMethodistRuns(req.teacher.id))
  })
)

export default router
