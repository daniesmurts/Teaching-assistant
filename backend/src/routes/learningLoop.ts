import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { getLearningLoopSummary } from '../services/learningLoopMetrics'

const router = Router()
router.use(authenticate)

// GET /api/learning-loop/summary
// Single endpoint that powers both the dashboard card (uses only the hero
// metric) and the full /learning-loop page (uses everything).
router.get('/summary', asyncHandler(async (req, res) => {
  res.json(await getLearningLoopSummary(req.teacher.id))
}))

export default router
