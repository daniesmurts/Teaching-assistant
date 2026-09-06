import { Router, type Request } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireDomain } from '../middleware/requireDomain'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { recordArtifactEvent } from '../db/queries/artifactEvents'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError } from '../errors/AppError'
import { getRootUnitForInstitution } from '../db/queries/orgUnits'
import { getUmcDashboard } from '../services/umcDashboard'
import { generateUmcDashboardXlsx } from '../services/umcDashboardXlsx'

// TODO.md Feature V — read-only УМЦ readiness dashboard. Gated on the 'umu'
// domain (an institution admin's domain='all' grant satisfies it too),
// same as РПД monitor — this is the УМУ/УМЦ head's own stats page, not a
// general 'curriculum' surface: ACCESS-MATRIX.md §6 already says other
// leadership (Ректор/Проректор/ДИ/ДЕК/ЗК/РОП/...) only sees these numbers
// once РУМЦ deliberately publishes/shares them (not yet built), never by
// grant. Was wrongly gated on 'curriculum' (shared by every content-facing
// role, including a plain РОП) — fixed after a live account walkthrough
// showed a single-programme РОП reaching an institution-wide stats page
// that was never meant for them. Institution-tier plan flag. 'view' only —
// this surface never writes anything, unlike rpdMonitor's 'edit' gate.
const router = Router()
router.use(authenticate)
router.use(requireDomain('umu', 'view'))
router.use(checkFeatureAccess('umcDashboard'))

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// Subtree scoping (Research.md §7.10 §1's "grant acts on its own unit and
// everything below" — same pattern as routes/institution.ts's
// resolveTeachingPrefixes). УМУ/РУМЦ grants are root-anchored in practice
// (institution/admin_office), so this is mostly a no-op today, but keeps
// findReadinessRows honest if a umu grant is ever scoped to a sub-unit.
async function resolveUmuPrefixes(req: Request): Promise<string[] | undefined> {
  if (!req.domainScope) return undefined
  const root = await getRootUnitForInstitution(institutionId(req))
  if (root && req.domainScope.pathPrefixes.includes(root.path)) return undefined
  return req.domainScope.pathPrefixes
}

// GET /api/institution/umc-dashboard
router.get('/', asyncHandler(async (req, res) => {
  const prefixes = await resolveUmuPrefixes(req)
  res.json(await getUmcDashboard(institutionId(req), prefixes))
}))

// GET /api/institution/umc-dashboard/export.xlsx
router.get('/export.xlsx', asyncHandler(async (req, res) => {
  const prefixes = await resolveUmuPrefixes(req)
  const data = await getUmcDashboard(institutionId(req), prefixes)
  const buffer = await generateUmcDashboardXlsx(data)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', 'attachment; filename="УМЦ_готовность.xlsx"')
  res.setHeader('Content-Length', buffer.length)
  res.end(buffer)

  // No artifact_id: the readiness dashboard is rendered from a live query,
  // never stored as a row.
  recordArtifactEvent({
    kind: 'umc_dashboard', event: 'exported',
    teacherId: req.teacher.id, institutionId: institutionId(req),
    format: 'xlsx',
  })
}))

export default router
