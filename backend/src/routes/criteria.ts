import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { checkResourceLimit } from '../middleware/checkPlan'
import { createCriterionRules, updateCriterionRules } from '../validation/criteriaValidation'
import {
  findCriteriaByTeacher, findCriterionById, createCriterion, updateCriterion, deleteCriterion,
  findGlobalTemplates, findCriteriaByInstitution,
} from '../db/queries/criteria'
import type { Criterion, CriterionSubject } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// GET /api/criteria — personal + institution-shared (institution members) + global templates
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  const own = await findCriteriaByTeacher(req.teacher.id, courseId)

  const shared = req.teacher.institution_id
    ? await findCriteriaByInstitution(req.teacher.institution_id)
    : []

  const byId = new Map<string, Criterion>()
  for (const c of [...own, ...shared]) byId.set(c.id, c)
  res.json(Array.from(byId.values()))
}))

// GET /api/criteria/templates — read-only global templates teachers can start from.
// MUST be before '/:id'.
router.get('/templates', asyncHandler(async (_req, res) => {
  res.json(await findGlobalTemplates())
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

export default router
