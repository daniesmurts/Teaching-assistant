import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { asyncHandler } from '../lib/asyncHandler'
import { getCapacityOverview } from '../services/capacityModel'

// TODO.md Feature AL Phase 2 — AdminCapacity page's one data endpoint.
// Deliberately a single call (not one per section) so the frontend has one
// query to key off the month/scenario selector, matching Phase 1's script
// output shape rather than fragmenting into N round trips.
const router = Router()
router.use(authenticate)
router.use(requireAdmin)

// GET /api/admin/capacity/overview?month=YYYY-MM&scenarioTeachers=N
router.get('/overview', asyncHandler(async (req, res) => {
  const month = typeof req.query.month === 'string' ? req.query.month : undefined
  const scenarioRaw = req.query.scenarioTeachers
  const scenarioTeachers = typeof scenarioRaw === 'string' && scenarioRaw.trim() !== ''
    ? Math.max(0, Math.round(Number(scenarioRaw)))
    : undefined

  const overview = await getCapacityOverview(month, Number.isFinite(scenarioTeachers) ? scenarioTeachers : undefined)
  if (!overview) {
    res.json({ noData: true, message: 'Нет данных — сначала запустите npm run rollup:backfill' })
    return
  }
  res.json(overview)
}))

export default router
