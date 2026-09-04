import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { generateQuizRules } from '../validation/quizValidation'
import { generateQuiz, assertQuizQuota } from '../services/quizzes'
import {
  findQuizzesByTeacher, findQuizById, deleteQuiz,
} from '../db/queries/quizzes'
import type { QuizLevel } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// POST /api/quizzes/generate
router.post(
  '/generate',
  aiLimiter,
  validate(generateQuizRules),
  asyncHandler(async (req, res) => {
    await assertQuizQuota(req.teacher.id, req.teacher.plan_tier)

    const { topic, question_count, course_id, level, source_text } = req.body as {
      topic:          string
      question_count: number
      course_id?:     string
      level?:         QuizLevel
      source_text?:   string
    }

    const result = await generateQuiz({
      teacherId:     req.teacher.id,
      courseId:      course_id,
      topic,
      questionCount: Number(question_count),
      level,
      sourceText:    source_text,
    })
    res.status(201).json(result)
  })
)

// GET /api/quizzes — history
router.get('/', asyncHandler(async (req, res) => {
  const courseId = req.query.course_id as string | undefined
  res.json(await findQuizzesByTeacher(req.teacher.id, courseId))
}))

// GET /api/quizzes/:id
router.get('/:id', asyncHandler(async (req, res) => {
  const quiz = await findQuizById(req.params.id, req.teacher.id)
  if (!quiz) throw new NotFoundError('Тест')
  res.json(quiz)
}))

// DELETE /api/quizzes/:id
router.delete('/:id', asyncHandler(async (req, res) => {
  const ok = await deleteQuiz(req.params.id, req.teacher.id)
  if (!ok) throw new NotFoundError('Тест')
  res.status(204).send()
}))

export default router
