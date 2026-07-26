import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireDomain } from '../middleware/requireDomain'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError } from '../errors/AppError'
import { getUmcDashboard } from '../services/umcDashboard'
import { generateUmcDashboardXlsx } from '../services/umcDashboardXlsx'

// TODO.md Feature V — read-only УМЦ readiness dashboard. Same gate as
// РПД monitor: 'curriculum' domain (an institution admin's domain='all'
// grant satisfies it too), Institution-tier plan flag. 'view' only — this
// surface never writes anything, unlike rpdMonitor's 'edit' gate.
const router = Router()
router.use(authenticate)
router.use(requireDomain('curriculum', 'view'))
router.use(checkFeatureAccess('umcDashboard'))

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// GET /api/institution/umc-dashboard
router.get('/', asyncHandler(async (req, res) => {
  res.json(await getUmcDashboard(institutionId(req)))
}))

// GET /api/institution/umc-dashboard/export.xlsx
router.get('/export.xlsx', asyncHandler(async (req, res) => {
  const data = await getUmcDashboard(institutionId(req))
  const buffer = await generateUmcDashboardXlsx(data)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="УМЦ_готовность.xlsx"')
  res.setHeader('Content-Length', buffer.length)
  res.end(buffer)
}))

export default router
