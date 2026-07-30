import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, PlanLimitError } from '../errors/AppError'
import { generateTopicsRules } from '../validation/topicsValidation'
import { getLimits, type PlanTier } from '../config/planLimits'
import { generateTopics } from '../services/topics'
import { listTopicSets, getTopicSet, deleteTopicSet, countTopicsThisMonth } from '../db/queries/topics'

const router = Router()
router.use(authenticate)

// POST /api/topics/generate
router.post(
  '/generate',
  aiLimiter,
  validate(generateTopicsRules),
  asyncHandler(async (req, res) => {
    // Monthly limit (count-based) — free tier capped, Pro/Institution unlimited
    const limit = getLimits(req.teacher.plan_tier as PlanTier).topicsPerMonth
    if (limit !== Infinity) {
      const used = await countTopicsThisMonth(req.teacher.id)
      if (used >= limit) {
        throw new PlanLimitError(
          `Достигнут месячный лимит генерации тем (${limit}). Перейдите на Pro для безлимита.`,
          'PLAN_LIMIT_REACHED'
        )
      }
    }

    const {
      level, work_type, field, interests, practice_site, course_id, count,
      student_name, student_group,
    } = req.body as {
      level: string; work_type: string; field?: string; interests?: string
      practice_site?: string; course_id?: string; count?: number
      student_name?: string; student_group?: string
    }

    const result = await generateTopics({
      teacherId:     req.teacher.id,
      institutionId: req.teacher.institution_id ?? undefined,
      courseId:     course_id,
      level,
      workType:     work_type,
      field,
      interests,
      practiceSite: practice_site,
      studentName:  student_name,
      studentGroup: student_group,
      count,
    })
    res.status(201).json(result)
  })
)

// GET /api/topics  — history
router.get('/', asyncHandler(async (req, res) => {
  res.json(await listTopicSets(req.teacher.id))
}))

// GET /api/topics/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const set = await getTopicSet(req.params.id, req.teacher.id)
  if (!set) throw new NotFoundError('Набор тем')
  res.json(set)
}))

// DELETE /api/topics/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteTopicSet(req.params.id, req.teacher.id)
  if (!ok) throw new NotFoundError('Набор тем')
  res.json({ ok: true })
}))

export default router
