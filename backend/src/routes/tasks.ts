import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, PlanLimitError } from '../errors/AppError'
import { generateTasksRules } from '../validation/tasksValidation'
import { getLimits, type PlanTier } from '../config/planLimits'
import { generateTasks } from '../services/tasks'
import { listTaskSets, getTaskSet, deleteTaskSet, countTasksThisMonth } from '../db/queries/tasks'

const router = Router()
router.use(authenticate)

// POST /api/tasks/generate
router.post(
  '/generate',
  aiLimiter,
  validate(generateTasksRules),
  asyncHandler(async (req, res) => {
    // Monthly limit (count-based) — free tier capped, Pro/Institution unlimited.
    const limit = getLimits(req.teacher.plan_tier as PlanTier).tasksPerMonth
    if (limit !== Infinity) {
      const used = await countTasksThisMonth(req.teacher.id)
      if (used >= limit) {
        throw new PlanLimitError(
          `Достигнут месячный лимит генерации заданий (${limit}). Перейдите на Pro для безлимита.`,
          'PLAN_LIMIT_REACHED'
        )
      }
    }

    const { kind, topic, difficulty, course_id, count } = req.body as {
      kind: 'assignment' | 'case' | 'project'
      topic: string; difficulty: string; course_id?: string; count?: number
    }

    const result = await generateTasks({
      teacherId:  req.teacher.id,
      kind,
      courseId:   course_id,
      topic,
      difficulty,
      count,
    })
    res.status(201).json(result)
  })
)

// GET /api/tasks?kind= — history (optionally filtered by kind)
router.get('/', asyncHandler(async (req, res) => {
  const kind = typeof req.query.kind === 'string' ? req.query.kind : undefined
  res.json(await listTaskSets(req.teacher.id, kind))
}))

// GET /api/tasks/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const set = await getTaskSet(req.params.id, req.teacher.id)
  if (!set) throw new NotFoundError('Набор заданий')
  res.json(set)
}))

// DELETE /api/tasks/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteTaskSet(req.params.id, req.teacher.id)
  if (!ok) throw new NotFoundError('Набор заданий')
  res.json({ ok: true })
}))

export default router
