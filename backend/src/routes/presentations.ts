import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { generatePresentation } from '../services/presentations'
import {
  findPresentationsByTeacher,
  findPresentationById,
  deletePresentation,
} from '../db/queries/presentations'

const router = Router()
router.use(authenticate)

// POST /api/presentations/generate
router.post(
  '/generate',
  aiLimiter,
  validate([
    { field: 'topic',            type: 'string', required: true },
    { field: 'duration_minutes', required: true },
  ]),
  async (req, res, next) => {
    try {
      const {
        course_id,
        lecture_number,
        topic,
        duration_minutes,
        learning_goals,
        audience_level,
        style,
        slide_count_target,
      } = req.body as {
        topic: string
        duration_minutes: number
        learning_goals?: string[]
        course_id?: string
        lecture_number?: number
        audience_level?: string
        style?: string
        slide_count_target?: number
      }

      const result = await generatePresentation({
        teacherId:       req.teacher.id,
        courseId:        course_id,
        lectureNumber:   lecture_number,
        topic,
        durationMinutes: Number(duration_minutes),
        learningGoals:   learning_goals ?? [],
        audienceLevel:   audience_level,
        style,
        slideCountTarget: slide_count_target ? Number(slide_count_target) : undefined,
      })

      res.status(201).json(result)
    } catch (err) { next(err) }
  }
)

// GET /api/presentations
router.get('/', async (req, res, next) => {
  try {
    const courseId = req.query.course_id as string | undefined
    const list = await findPresentationsByTeacher(req.teacher.id, courseId)
    res.json(list)
  } catch (err) { next(err) }
})

// GET /api/presentations/:id
router.get('/:id', async (req, res, next) => {
  try {
    const p = await findPresentationById(req.params.id, req.teacher.id)
    if (!p) { res.status(404).json({ error: 'Презентация не найдена' }); return }
    res.json(p)
  } catch (err) { next(err) }
})

// DELETE /api/presentations/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const deleted = await deletePresentation(req.params.id, req.teacher.id)
    if (!deleted) { res.status(404).json({ error: 'Презентация не найдена' }); return }
    res.status(204).send()
  } catch (err) { next(err) }
})

export default router
