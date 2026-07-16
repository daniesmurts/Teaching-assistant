import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError, ForbiddenError } from '../errors/AppError'
import { checkResourceLimit, checkMonthlyLimit } from '../middleware/checkPlan'
import { aiLimiter } from '../middleware/rateLimits'
import { createCriterionRules, updateCriterionRules, improveDescriptionRules } from '../validation/criteriaValidation'
import {
  findCriteriaByTeacher, findCriterionById, createCriterion, updateCriterion, deleteCriterion,
  findGlobalTemplates, findCriteriaSharedWithTeacher, shareCriterion, unshareCriterion,
} from '../db/queries/criteria'
import { incrementUsage } from '../db/queries/usageCounters'
import { improveCriterionDescription } from '../services/criteriaAssist'
import { canShareToUnit } from '../services/orgScope'
import { listShareTargetsForTeacher } from '../db/queries/orgUnits'
import type { Criterion, CriterionSubject } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// GET /api/criteria — personal + shared via the org tree + global templates
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  const own = await findCriteriaByTeacher(req.teacher.id, courseId)
  const shared = await findCriteriaSharedWithTeacher(req.teacher.id)

  const byId = new Map<string, Criterion>()
  for (const c of [...own, ...shared]) byId.set(c.id, c)
  res.json(Array.from(byId.values()))
}))

// GET /api/criteria/templates — read-only global templates teachers can start from.
// MUST be before '/:id'.
router.get('/templates', asyncHandler(async (_req, res) => {
  res.json(await findGlobalTemplates())
}))

// GET /api/criteria/share-targets — org units the teacher may share into
// (their own department → faculty → institution), root-first. MUST be
// before '/:id'.
router.get('/share-targets', asyncHandler(async (req, res) => {
  res.json(await listShareTargetsForTeacher(req.teacher.id))
}))

router.post(
  '/',
  checkResourceLimit('criteria', 'maxCriteria'),
  validate(createCriterionRules),
  asyncHandler(async (req, res) => {
    const { name, description, course_id, subject } = req.body as {
      name: string
      description?: string
      course_id?: string
      subject?: CriterionSubject
    }
    const criterion = await createCriterion(req.teacher.id, {
      name,
      description,
      course_id,
      subject,
    })
    res.status(201).json(criterion)
  })
)

// POST /api/criteria/improve-description — AI rewrite of a rough description
// into grading-prompt-friendly text. Teacher accepts/rejects client-side;
// nothing persists here.
router.post(
  '/improve-description',
  aiLimiter,
  checkMonthlyLimit('criteriaImprovePerMonth'),
  validate(improveDescriptionRules),
  asyncHandler(async (req, res) => {
    const { name, description } = req.body as { name: string; description: string }
    if (!description.trim()) throw new ValidationError('Сначала введите описание критерия')

    const improved = await improveCriterionDescription({
      name,
      description,
      context: {
        teacherId:     req.teacher.id,
        institutionId: req.teacher.institution_id ?? undefined,
        feature:       'criteria_assist',
      },
    })

    incrementUsage(req.teacher.id, 'criteria_improve').catch(() => null)
    res.json({ improved })
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const criterion = await findCriterionById(req.params.id, req.teacher.id)
  if (!criterion) throw new NotFoundError('Критерий')
  res.json(criterion)
}))

router.put('/:id', validate(updateCriterionRules), asyncHandler(async (req, res) => {
  const criterion = await updateCriterion(
    req.params.id, req.teacher.id,
    req.body as { name?: string; description?: string; course_id?: string; subject?: CriterionSubject }
  )
  if (!criterion) throw new NotFoundError('Критерий')
  res.json(criterion)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteCriterion(req.params.id, req.teacher.id)
  if (!ok) throw new NotFoundError('Критерий')
  res.status(204).send()
}))

// POST /api/criteria/:id/share — owner shares their criterion with an org unit
// (their own department/faculty/institution, or a unit they head/administer).
router.post('/:id/share', asyncHandler(async (req, res) => {
  const unitId = req.body?.unit_id as string | undefined
  if (!unitId) throw new ValidationError('Не указано подразделение')

  const allowed = await canShareToUnit(req.teacher.id, unitId)
  if (!allowed) throw new ForbiddenError('Нельзя поделиться с этим подразделением')

  const criterion = await shareCriterion(req.params.id, req.teacher.id, unitId)
  if (!criterion) throw new NotFoundError('Критерий')
  res.json(criterion)
}))

router.post('/:id/unshare', asyncHandler(async (req, res) => {
  const criterion = await unshareCriterion(req.params.id, req.teacher.id)
  if (!criterion) throw new NotFoundError('Критерий')
  res.json(criterion)
}))

export default router
