import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import {
  findCoursesByTeacher,
  findCourseById,
  createCourse,
  updateCourse,
  deleteCourse,
} from '../db/queries/courses'

const router = Router()
router.use(authenticate)

router.get('/', async (req, res, next) => {
  try {
    const courses = await findCoursesByTeacher(req.teacher.id)
    res.json(courses)
  } catch (err) { next(err) }
})

router.post('/', validate([{ field: 'name', type: 'string', required: true }]), async (req, res, next) => {
  try {
    const course = await createCourse(req.teacher.id, req.body as { name: string; code?: string; level?: string; syllabus_text?: string })
    res.status(201).json(course)
  } catch (err) { next(err) }
})

router.get('/:id', async (req, res, next) => {
  try {
    const course = await findCourseById(req.params.id, req.teacher.id)
    if (!course) { res.status(404).json({ error: 'Course not found' }); return }
    res.json(course)
  } catch (err) { next(err) }
})

router.put('/:id', async (req, res, next) => {
  try {
    const course = await updateCourse(req.params.id, req.teacher.id, req.body as { name?: string; code?: string; level?: string; syllabus_text?: string })
    if (!course) { res.status(404).json({ error: 'Course not found' }); return }
    res.json(course)
  } catch (err) { next(err) }
})

router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await deleteCourse(req.params.id, req.teacher.id)
    if (!deleted) { res.status(404).json({ error: 'Course not found' }); return }
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
