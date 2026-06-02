import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import {
  findRubricsByTeacher,
  findRubricById,
  createRubric,
  updateRubric,
  deleteRubric,
} from '../db/queries/rubrics'

const router = Router()
router.use(authenticate)

router.get('/', async (req, res, next) => {
  try {
    const courseId = req.query.course_id as string | undefined
    const rubrics = await findRubricsByTeacher(req.teacher.id, courseId)
    res.json(rubrics)
  } catch (err) { next(err) }
})

router.post(
  '/',
  validate([
    { field: 'name', type: 'string', required: true },
    { field: 'criteria', required: true },
  ]),
  async (req, res, next) => {
    try {
      const rubric = await createRubric(req.teacher.id, req.body as { name: string; course_id?: string; criteria: unknown[]; is_default?: boolean })
      res.status(201).json(rubric)
    } catch (err) { next(err) }
  }
)

router.get('/:id', async (req, res, next) => {
  try {
    const rubric = await findRubricById(req.params.id, req.teacher.id)
    if (!rubric) { res.status(404).json({ error: 'Rubric not found' }); return }
    res.json(rubric)
  } catch (err) { next(err) }
})

router.put('/:id', async (req, res, next) => {
  try {
    const rubric = await updateRubric(req.params.id, req.teacher.id, req.body as { name?: string; criteria?: unknown[]; is_default?: boolean })
    if (!rubric) { res.status(404).json({ error: 'Rubric not found' }); return }
    res.json(rubric)
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await deleteRubric(req.params.id, req.teacher.id)
    if (!deleted) { res.status(404).json({ error: 'Rubric not found' }); return }
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
