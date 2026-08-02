import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError } from '../errors/AppError'
import { getCostPerActiveTeacher, listInstitutionsWithActivation } from '../db/queries/pricingCost'
import { getPricingAssumptions, upsertPricingAssumptions, type PricingAssumptionsPatch } from '../db/queries/pricingAssumptions'
import { getUsdRubRate } from '../services/fxRate'

// Platform-admin-only pricing negotiation tool (TODO.md — AdminPricing page).
// Modeling only: no write path here ever touches billing/T-Bank or changes a
// live price. Same sensitivity level as the Usage tab's cost data — gated
// identically (authenticate + requireAdmin), never exposed to
// institution_admin/teacher roles.
const router = Router()
router.use(authenticate)
router.use(requireAdmin)

function parseDays(raw: unknown): number {
  const n = parseInt(typeof raw === 'string' ? raw : '30', 10)
  if (!Number.isFinite(n) || n <= 0) return 30
  return Math.min(n, 365)
}

function parseInstitutionId(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null
}

// GET /api/admin/pricing/cost-inputs?days=30&institutionId=...
// Real per-active-teacher cost, split token vs. OCR, plus the ₽ rate used to
// convert it — the frontend must label every figure with its source
// ("computed from usage table" vs. "manual estimate"), this endpoint only
// ever returns the measured half.
router.get('/cost-inputs', asyncHandler(async (req, res) => {
  const days = parseDays(req.query.days)
  const institutionId = parseInstitutionId(req.query.institutionId)

  const [cost, fx] = await Promise.all([
    getCostPerActiveTeacher(days, institutionId),
    getUsdRubRate(),
  ])

  res.json({
    ...cost,
    tokenCostPerTeacherRub: cost.tokenCostPerTeacherUsd * fx.rate,
    ocrCostPerTeacherRub:   cost.ocrCostPerTeacherUsd * fx.rate,
    fxRate:     fx.rate,
    fxRateDate: fx.date,
  })
}))

// GET /api/admin/pricing/institutions?days=30
// Same institution list the Institutions tab shows, plus a real trailing-
// window activation rate per institution — reuses teachers/institutions,
// no new source of truth.
router.get('/institutions', asyncHandler(async (req, res) => {
  const days = parseDays(req.query.days)
  res.json(await listInstitutionsWithActivation(days))
}))

// GET /api/admin/pricing/assumptions?institutionId=...
// Omit institutionId (or pass empty) for the global-defaults row.
router.get('/assumptions', asyncHandler(async (req, res) => {
  const institutionId = parseInstitutionId(req.query.institutionId)
  res.json(await getPricingAssumptions(institutionId))
}))

// PUT /api/admin/pricing/assumptions?institutionId=...
router.put('/assumptions', asyncHandler(async (req, res) => {
  const institutionId = parseInstitutionId(req.query.institutionId)
  const { activation_override, margin_multiplier, max_discount_pct, cost_per_active_teacher_manual_override_rub } =
    req.body as {
      activation_override?: unknown
      margin_multiplier?: unknown
      max_discount_pct?: unknown
      cost_per_active_teacher_manual_override_rub?: unknown
    }

  const patch: PricingAssumptionsPatch = {}

  if (activation_override !== undefined) {
    if (activation_override === null) {
      patch.activationOverride = null
    } else {
      const v = Number(activation_override)
      if (!Number.isFinite(v) || v < 0 || v > 100) throw new ValidationError('Активация должна быть от 0 до 100%')
      patch.activationOverride = v
    }
  }
  if (margin_multiplier !== undefined) {
    const v = Number(margin_multiplier)
    if (!Number.isFinite(v) || v <= 0) throw new ValidationError('Множитель маржи должен быть положительным числом')
    patch.marginMultiplier = v
  }
  if (max_discount_pct !== undefined) {
    const v = Number(max_discount_pct)
    if (!Number.isFinite(v) || v < 0 || v > 100) throw new ValidationError('Максимальная скидка должна быть от 0 до 100%')
    patch.maxDiscountPct = v
  }
  if (cost_per_active_teacher_manual_override_rub !== undefined) {
    if (cost_per_active_teacher_manual_override_rub === null) {
      patch.costPerActiveTeacherManualOverrideRub = null
    } else {
      const v = Number(cost_per_active_teacher_manual_override_rub)
      if (!Number.isFinite(v) || v < 0) throw new ValidationError('Ручная оценка стоимости должна быть неотрицательным числом')
      patch.costPerActiveTeacherManualOverrideRub = v
    }
  }

  const updated = await upsertPricingAssumptions(institutionId, patch, req.teacher.id)
  res.json(updated)
}))

export default router
