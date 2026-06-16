import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { analyzeOverlapRules } from '../validation/curriculumValidation'
import { analyzeCurriculumOverlap } from '../services/curriculumAnalysis'

const router = Router()
router.use(authenticate)

// POST /api/curriculum/overlap
// КНИТУ admin feature A3 — detect duplicated/overlapping topics across the
// disciplines a single student takes. Operates on the teacher's own courses
// for now (curriculum/учебный план is not yet a first-class entity).
router.post(
  '/overlap',
  aiLimiter,
  validate(analyzeOverlapRules),
  asyncHandler(async (req, res) => {
    const { course_ids } = req.body as { course_ids: string[] }
    const result = await analyzeCurriculumOverlap({
      teacherId: req.teacher.id,
      courseIds: course_ids,
    })
    res.json(result)
  })
)

export default router
