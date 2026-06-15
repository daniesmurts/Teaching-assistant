import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { asyncHandler } from '../lib/asyncHandler'
import { pool } from '../db/connection'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  getDailyUsage, getUsageByTeacher, getTodayCost,
  getUsageByFeature, getRecentErrors,
} from '../db/queries/usageLog'
import { upgradeTeacherToPro, cancelTeacherSubscription } from '../db/queries/teachers'
import { listInstitutionsWithCounts, createInstitution, updateInstitution } from '../db/queries/institutions'
import { listFeedback } from '../db/queries/feedback'
import {
  findPaymentsByTeacher, findPaymentByOrderId, markPaymentRefunded,
} from '../db/queries/payments'
import { refundPayment } from '../services/tbank'
import {
  findGlobalRubricTemplates, createGlobalRubricTemplate,
  updateGlobalRubricTemplate, deleteGlobalRubricTemplate,
} from '../db/queries/rubrics'
import type { RubricItem, CriterionSubject } from '../../../shared/types'

const router = Router()
router.use(authenticate)
router.use(requireAdmin)

// ─── GET /api/admin/overview ──────────────────────────────────────────────────

router.get('/overview', asyncHandler(async (_req, res) => {
  const [overview, todayCost] = await Promise.all([
    pool.query<{
      total_teachers:         string
      active_this_week:       string
      new_this_month:         string
      total_grades:           string
      total_presentations:    string
      grades_today:           string
    }>(`
      SELECT
        COUNT(*)                                                                       AS total_teachers,
        COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')               AS active_this_week,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))               AS new_this_month,
        (SELECT COUNT(*) FROM assignments)                                             AS total_grades,
        (SELECT COUNT(*) FROM presentations)                                           AS total_presentations,
        (SELECT COUNT(*) FROM assignments WHERE created_at >= CURRENT_DATE)            AS grades_today
      FROM teachers
    `),
    getTodayCost(),
  ])

  const r = overview.rows[0]
  res.json({
    totalTeachers:      parseInt(r.total_teachers,      10),
    activeThisWeek:     parseInt(r.active_this_week,    10),
    newThisMonth:       parseInt(r.new_this_month,      10),
    totalGrades:        parseInt(r.total_grades,        10),
    totalPresentations: parseInt(r.total_presentations, 10),
    gradesToday:        parseInt(r.grades_today,        10),
    todayCostUsd:       todayCost,
  })
}))

// ─── GET /api/admin/usage/daily?days=30 ───────────────────────────────────────

router.get('/usage/daily', asyncHandler(async (req, res) => {
  const days = parseInt((req.query.days as string) ?? '30', 10)
  res.json(await getDailyUsage(Math.min(days, 365)))
}))

// ─── GET /api/admin/usage/by-teacher ─────────────────────────────────────────

router.get('/usage/by-teacher', asyncHandler(async (req, res) => {
  const limit = parseInt((req.query.limit as string) ?? '20', 10)
  res.json(await getUsageByTeacher(Math.min(limit, 100)))
}))

// ─── GET /api/admin/usage/by-feature?days=30 ─────────────────────────────────

router.get('/usage/by-feature', asyncHandler(async (req, res) => {
  const days = parseInt((req.query.days as string) ?? '30', 10)
  res.json(await getUsageByFeature(Math.min(days, 365)))
}))

// ─── GET /api/admin/errors?days=7 ────────────────────────────────────────────

router.get('/errors', asyncHandler(async (req, res) => {
  const days = parseInt((req.query.days as string) ?? '7', 10)
  res.json(await getRecentErrors(Math.min(days, 90)))
}))

// ─── Global criteria templates ────────────────────────────────────────────────

router.get('/criteria/templates', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, description, subject, created_at
       FROM criteria
      WHERE is_global_template = TRUE
      ORDER BY subject, name`
  )
  res.json(rows)
}))

router.post('/criteria/templates', asyncHandler(async (req, res) => {
  const { name, description, subject } = req.body as {
    name: string; description?: string; subject?: string
  }
  if (!name?.trim()) throw new ValidationError('Название критерия обязательно')
  const { rows } = await pool.query(
    `INSERT INTO criteria (teacher_id, name, description, subject, is_global_template)
     VALUES (NULL, $1, $2, $3, TRUE)
     RETURNING id, name, description, subject, created_at`,
    [name.trim(), description ?? null, subject ?? 'general']
  )
  res.status(201).json(rows[0])
}))

router.delete('/criteria/templates/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM criteria WHERE id = $1 AND is_global_template = TRUE',
    [req.params.id]
  )
  if (!rowCount) { res.status(404).json({ error: 'Шаблон не найден' }); return }
  res.status(204).send()
}))

// ─── Global rubric templates ──────────────────────────────────────────────────
//
// Same idea as criterion templates: admin-curated rubric presets every teacher
// sees at the bottom of their library. Items reference global criterion
// templates (so they resolve for any teacher's account).

interface RubricTemplateBody {
  name:         string
  description?: string
  subject?:     CriterionSubject
  items:        RubricItem[]
}

function validateTemplateBody(body: RubricTemplateBody, partial = false): void {
  if (!partial && !body.name?.trim()) throw new ValidationError('Название рубрики обязательно')
  if (body.items) {
    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new ValidationError('Рубрика должна содержать хотя бы один критерий')
    }
    const total = body.items.reduce((s, it) => s + (Number(it.weight) || 0), 0)
    if (total !== 100) {
      throw new ValidationError(`Сумма весов критериев должна быть 100% (сейчас ${total}%)`)
    }
  } else if (!partial) {
    throw new ValidationError('Рубрика должна содержать критерии')
  }
}

router.get('/rubrics/templates', asyncHandler(async (_req, res) => {
  res.json(await findGlobalRubricTemplates())
}))

router.post('/rubrics/templates', asyncHandler(async (req, res) => {
  const body = req.body as RubricTemplateBody
  validateTemplateBody(body)
  const rubric = await createGlobalRubricTemplate({
    name:        body.name.trim(),
    description: body.description,
    subject:     body.subject,
    items:       body.items,
  })
  res.status(201).json(rubric)
}))

router.put('/rubrics/templates/:id', asyncHandler(async (req, res) => {
  const body = req.body as Partial<RubricTemplateBody>
  validateTemplateBody(body as RubricTemplateBody, true)
  const rubric = await updateGlobalRubricTemplate(req.params.id, {
    name:        body.name?.trim(),
    description: body.description,
    subject:     body.subject,
    items:       body.items,
  })
  if (!rubric) throw new NotFoundError('Шаблон рубрики')
  res.json(rubric)
}))

router.delete('/rubrics/templates/:id', asyncHandler(async (req, res) => {
  const ok = await deleteGlobalRubricTemplate(req.params.id)
  if (!ok) { res.status(404).json({ error: 'Шаблон не найден' }); return }
  res.status(204).send()
}))

// ─── GET /api/admin/teachers ──────────────────────────────────────────────────

router.get('/teachers', asyncHandler(async (req, res) => {
  const page   = Math.max(1, parseInt((req.query.page  as string) ?? '1',  10))
  const limit  = Math.min(50,  parseInt((req.query.limit as string) ?? '20', 10))
  const search = (req.query.search as string | undefined)?.trim()
  const offset = (page - 1) * limit

  const where  = search ? `WHERE t.email ILIKE $3 OR t.name ILIKE $3` : ''
  const params = search ? [limit, offset, `%${search}%`] : [limit, offset]

  const [{ rows }, { rows: countRows }] = await Promise.all([
    pool.query(
      `SELECT t.id, t.email, t.name, t.university, t.role, t.plan_tier,
              t.is_active, t.created_at, t.institution_id, i.name AS institution_name,
              COUNT(a.id)::int AS grade_count
       FROM teachers t
       LEFT JOIN assignments a  ON a.teacher_id = t.id
       LEFT JOIN institutions i ON i.id = t.institution_id
       ${where}
       GROUP BY t.id, i.name
       ORDER BY t.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total FROM teachers t ${where}`,
      search ? [`%${search}%`] : []
    ),
  ])

  res.json({ teachers: rows, total: countRows[0].total })
}))

// ─── PATCH /api/admin/teachers/:id ───────────────────────────────────────────

router.patch('/teachers/:id', asyncHandler(async (req, res) => {
  const body = req.body as {
    role?: string; plan_tier?: string; is_active?: boolean; institution_id?: string | null
  }
  const { role, plan_tier, is_active } = body
  // institution_id is explicit: '' / null → unassign, uuid → assign, absent → leave
  const hasInstitution = Object.prototype.hasOwnProperty.call(body, 'institution_id')
  const institutionId  = body.institution_id ? body.institution_id : null

  const { rows } = await pool.query(
    `UPDATE teachers
     SET role           = COALESCE($2, role),
         plan_tier      = COALESCE($3, plan_tier),
         is_active      = COALESCE($4, is_active),
         institution_id = CASE WHEN $5 THEN $6 ELSE institution_id END
     WHERE id = $1
     RETURNING id, email, name, role, plan_tier, is_active, institution_id`,
    [req.params.id, role ?? null, plan_tier ?? null, is_active ?? null, hasInstitution, institutionId]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Преподаватель не найден' }); return }
  res.json(rows[0])
}))

// ─── Subscription management ──────────────────────────────────────────────────

// Grant or extend Pro by N days (no payment) — used for comps, support, etc.
router.post('/teachers/:id/subscription/grant', asyncHandler(async (req, res) => {
  const days = Number((req.body as { days?: unknown }).days)
  if (!Number.isInteger(days) || days < 1 || days > 3650) {
    throw new ValidationError('Укажите число дней от 1 до 3650')
  }
  const { rows } = await pool.query('SELECT id FROM teachers WHERE id = $1', [req.params.id])
  if (!rows[0]) throw new NotFoundError('Преподаватель')

  await upgradeTeacherToPro(req.params.id, days, 'admin_grant')
  const { rows: fresh } = await pool.query(
    'SELECT id, email, plan_tier, plan_expires_at FROM teachers WHERE id = $1',
    [req.params.id]
  )
  res.json(fresh[0])
}))

// Cancel a subscription — immediate downgrade to free.
router.post('/teachers/:id/subscription/cancel', asyncHandler(async (req, res) => {
  const { rows } = await pool.query('SELECT id FROM teachers WHERE id = $1', [req.params.id])
  if (!rows[0]) throw new NotFoundError('Преподаватель')

  await cancelTeacherSubscription(req.params.id)
  res.json({ id: req.params.id, plan_tier: 'free' })
}))

// List a teacher's payments (so the admin can pick one to refund).
router.get('/teachers/:id/payments', asyncHandler(async (req, res) => {
  const rows = await findPaymentsByTeacher(req.params.id)
  res.json(rows.map((p) => ({
    order_id:       p.order_id,
    plan:           p.plan,
    amount_kopecks: p.amount_kopecks,
    status:         p.status,
    payment_id:     p.payment_id,
    created_at:     p.created_at,
    confirmed_at:   p.confirmed_at,
  })))
}))

// Refund a confirmed payment via T-Bank. Money only — does NOT auto-cancel
// access (admin decides separately whether to cancel the subscription).
router.post('/payments/:orderId/refund', asyncHandler(async (req, res) => {
  const payment = await findPaymentByOrderId(req.params.orderId)
  if (!payment) throw new NotFoundError('Платёж')
  if (payment.status !== 'confirmed') {
    throw new ValidationError('Возврат возможен только для оплаченного платежа')
  }
  if (!payment.payment_id) {
    throw new ValidationError('У платежа нет идентификатора T-Bank')
  }

  const status = await refundPayment(payment.payment_id)   // REFUNDED | PARTIAL_REFUNDED
  await markPaymentRefunded(payment.order_id)
  res.json({ order_id: payment.order_id, status })
}))

// ─── Feedback ─────────────────────────────────────────────────────────────────

router.get('/feedback', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500)
  res.json(await listFeedback(limit))
}))

// ─── Institutions ─────────────────────────────────────────────────────────────

const PLAN_TIERS = ['free', 'pro', 'institution']

router.get('/institutions', asyncHandler(async (_req, res) => {
  res.json(await listInstitutionsWithCounts())
}))

// Normalize a user-entered domain ("@MGU.ru", "https://mgu.ru/") → "mgu.ru"
function normalizeDomain(v: unknown): string | null {
  if (v == null || v === '') return null
  return String(v).trim().toLowerCase().replace(/^@/, '').replace(/^https?:\/\//, '').replace(/\/.*$/, '') || null
}

router.post('/institutions', asyncHandler(async (req, res) => {
  const { name, planTier, maxTeachers, emailDomain } = req.body as { name?: string; planTier?: string; maxTeachers?: unknown; emailDomain?: unknown }
  if (!name?.trim()) throw new ValidationError('Укажите название организации')
  const tier = planTier && PLAN_TIERS.includes(planTier) ? planTier : 'institution'
  const max  = maxTeachers === null || maxTeachers === undefined || maxTeachers === ''
    ? null : Number(maxTeachers)
  if (max !== null && (!Number.isInteger(max) || max < 1)) throw new ValidationError('Лимит мест должен быть положительным числом')

  res.status(201).json(await createInstitution({
    name: name.trim(), planTier: tier, maxTeachers: max, emailDomain: normalizeDomain(emailDomain),
  }))
}))

router.patch('/institutions/:id', asyncHandler(async (req, res) => {
  const { name, planTier, maxTeachers, emailDomain } = req.body as { name?: string; planTier?: string; maxTeachers?: unknown; emailDomain?: unknown }
  if (planTier && !PLAN_TIERS.includes(planTier)) throw new ValidationError('Неверный тариф')
  const patch: { name?: string; planTier?: string; maxTeachers?: number | null; emailDomain?: string | null } = {}
  if (name !== undefined)     patch.name = name.trim()
  if (planTier !== undefined) patch.planTier = planTier
  if (emailDomain !== undefined) patch.emailDomain = normalizeDomain(emailDomain)
  if (maxTeachers !== undefined) {
    patch.maxTeachers = maxTeachers === null || maxTeachers === '' ? null : Number(maxTeachers)
    if (patch.maxTeachers !== null && (!Number.isInteger(patch.maxTeachers) || patch.maxTeachers < 1)) {
      throw new ValidationError('Лимит мест должен быть положительным числом')
    }
  }

  const updated = await updateInstitution(req.params.id, patch)
  if (!updated) throw new NotFoundError('Организация')
  res.json(updated)
}))

export default router
