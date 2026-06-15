import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { checkResourceLimit } from '../middleware/checkPlan'
import { createRubricRules, updateRubricRules } from '../validation/rubricsValidation'
import {
  findRubricsByTeacher, findRubricByIdForTeacher, createRubric, updateRubric, deleteRubric,
  findGlobalRubricTemplates, findRubricsByInstitution,
} from '../db/queries/rubrics'
import { findCriteriaByIds } from '../db/queries/criteria'
import type { Rubric, RubricItem, CriterionSubject } from '../../../shared/types'

const router = Router()
router.use(authenticate)

/**
 * Throw a friendly ValidationError if the rubric's items don't pass the
 * structural rules the model relies on at grade time:
 *   - weights sum to 100
 *   - no duplicate criterion_ids
 *   - every criterion is one the teacher is currently allowed to use
 *     (own + institution-shared + global)
 */
async function assertItemsValid(
  items: RubricItem[],
  teacherId: string,
  institutionId: string | null
): Promise<void> {
  const total = items.reduce((s, it) => s + it.weight, 0)
  if (total !== 100) {
    throw new ValidationError(`Сумма весов критериев должна быть 100% (сейчас ${total}%)`)
  }
  const ids = items.map((it) => it.criterion_id)
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('Критерии в рубрике не должны повторяться')
  }
  const resolved = await findCriteriaByIds(ids, teacherId, institutionId)
  if (resolved.length !== new Set(ids).size) {
    throw new ValidationError('Один или несколько критериев недоступны')
  }
}

// GET /api/rubrics — personal + institution-shared (members) + global templates
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  const own = await findRubricsByTeacher(req.teacher.id, courseId)

  const shared = req.teacher.institution_id
    ? await findRubricsByInstitution(req.teacher.institution_id)
    : []

  const byId = new Map<string, Rubric>()
  for (const r of [...own, ...shared]) byId.set(r.id, r)
  res.json(Array.from(byId.values()))
}))

// GET /api/rubrics/templates — global, read-only — MUST be before '/:id'
router.get('/templates', asyncHandler(async (_req, res) => {
  res.json(await findGlobalRubricTemplates())
}))

router.post(
  '/',
  checkResourceLimit('rubrics', 'maxRubrics'),
  validate(createRubricRules),
  asyncHandler(async (req, res) => {
    const { name, description, course_id, subject, items } = req.body as {
      name: string
      description?: string
      course_id?: string
      subject?: CriterionSubject
      items: RubricItem[]
    }
    await assertItemsValid(items, req.teacher.id, req.teacher.institution_id ?? null)
    const rubric = await createRubric(req.teacher.id, { name, description, course_id, subject, items })
    res.status(201).json(rubric)
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const rubric = await findRubricByIdForTeacher(
    req.params.id, req.teacher.id, req.teacher.institution_id ?? null
  )
  if (!rubric) throw new NotFoundError('Рубрика')
  res.json(rubric)
}))

router.put('/:id', validate(updateRubricRules), asyncHandler(async (req, res) => {
  const body = req.body as {
    name?: string
    description?: string
    course_id?: string
    subject?: CriterionSubject
    items?: RubricItem[]
  }
  if (body.items) {
    await assertItemsValid(body.items, req.teacher.id, req.teacher.institution_id ?? null)
  }
  const rubric = await updateRubric(req.params.id, req.teacher.id, body)
  if (!rubric) throw new NotFoundError('Рубрика')
  res.json(rubric)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteRubric(req.params.id, req.teacher.id)
  if (!ok) throw new NotFoundError('Рубрика')
  res.status(204).send()
}))

export default router
