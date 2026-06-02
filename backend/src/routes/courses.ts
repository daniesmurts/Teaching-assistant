import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { checkResourceLimit } from '../middleware/checkPlan'
import {
  findCoursesByTeacher, findCourseById, createCourse, updateCourse, deleteCourse,
} from '../db/queries/courses'

const router = Router()
router.use(authenticate)

router.get('/', asyncHandler(async (req, res) => {
  res.json(await findCoursesByTeacher(req.teacher.id))
}))

router.post(
  '/',
  checkResourceLimit('courses', 'maxCourses'),
  validate([{ field: 'name', type: 'string', required: true }]),
  asyncHandler(async (req, res) => {
    const course = await createCourse(
      req.teacher.id,
      req.body as { name: string; code?: string; level?: string; syllabus_text?: string }
    )
    res.status(201).json(course)
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Курс')
  res.json(course)
}))

router.put('/:id', asyncHandler(async (req, res) => {
  const course = await updateCourse(
    req.params.id, req.teacher.id,
    req.body as { name?: string; code?: string; level?: string; syllabus_text?: string }
  )
  if (!course) throw new NotFoundError('Курс')
  res.json(course)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await deleteCourse(req.params.id, req.teacher.id)
  if (!deleted) throw new NotFoundError('Курс')
  res.status(204).send()
}))

export default router
