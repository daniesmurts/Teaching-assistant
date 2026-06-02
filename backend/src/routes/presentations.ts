import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { checkMonthlyLimit } from '../middleware/checkPlan'
import { generatePresentation } from '../services/presentations'
import {
  findPresentationsByTeacher, findPresentationById, deletePresentation,
} from '../db/queries/presentations'

const router = Router()
router.use(authenticate)

// POST /api/presentations/generate
router.post(
  '/generate',
  aiLimiter,
  checkMonthlyLimit('presentationsPerMonth'),
  validate([
    { field: 'topic',            type: 'string', required: true },
    { field: 'duration_minutes', required: true },
  ]),
  asyncHandler(async (req, res) => {
    const {
      course_id, lecture_number, topic, duration_minutes,
      learning_goals, audience_level, style, slide_count_target,
    } = req.body as {
      topic: string; duration_minutes: number; learning_goals?: string[]
      course_id?: string; lecture_number?: number; audience_level?: string
      style?: string; slide_count_target?: number
    }

    const result = await generatePresentation({
      teacherId:        req.teacher.id,
      courseId:         course_id,
      lectureNumber:    lecture_number,
      topic,
      durationMinutes:  Number(duration_minutes),
      learningGoals:    learning_goals ?? [],
      audienceLevel:    audience_level,
      style,
      slideCountTarget: slide_count_target ? Number(slide_count_target) : undefined,
    })
    res.status(201).json(result)
  })
)

// GET /api/presentations
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  res.json(await findPresentationsByTeacher(req.teacher.id, courseId))
}))

// GET /api/presentations/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const p = await findPresentationById(req.params.id, req.teacher.id)
  if (!p) throw new NotFoundError('Презентация')
  res.json(p)
}))

// DELETE /api/presentations/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await deletePresentation(req.params.id, req.teacher.id)
  if (!deleted) throw new NotFoundError('Презентация')
  res.status(204).send()
}))

export default router
