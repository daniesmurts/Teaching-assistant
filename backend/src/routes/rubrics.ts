import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { checkResourceLimit } from '../middleware/checkPlan'
import { createRubricRules, updateRubricRules } from '../validation/rubricValidation'
import {
  findRubricsByTeacher, findRubricById, createRubric, updateRubric, deleteRubric,
  findGlobalTemplates,
} from '../db/queries/rubrics'
import type { RubricCriterion } from '../../../shared/types'

const router = Router()
router.use(authenticate)

router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  res.json(await findRubricsByTeacher(req.teacher.id, courseId))
}))

// Global template rubrics teachers can start from (read-only). MUST be before '/:id'.
router.get('/templates', asyncHandler(async (_req, res) => {
  res.json(await findGlobalTemplates())
}))

router.post(
  '/',
  checkResourceLimit('rubrics', 'maxRubrics'),
  validate(createRubricRules),
  asyncHandler(async (req, res) => {
    const rubric = await createRubric(
      req.teacher.id,
      req.body as { name: string; course_id?: string; criteria: RubricCriterion[]; is_default?: boolean }
    )
    res.status(201).json(rubric)
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const rubric = await findRubricById(req.params.id, req.teacher.id)
  if (!rubric) throw new NotFoundError('Рубрика')
  res.json(rubric)
}))

router.put('/:id', validate(updateRubricRules), asyncHandler(async (req, res) => {
  const rubric = await updateRubric(
    req.params.id, req.teacher.id,
    req.body as { name?: string; criteria?: RubricCriterion[]; is_default?: boolean }
  )
  if (!rubric) throw new NotFoundError('Рубрика')
  res.json(rubric)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await deleteRubric(req.params.id, req.teacher.id)
  if (!deleted) throw new NotFoundError('Рубрика')
  res.status(204).send()
}))

export default router
