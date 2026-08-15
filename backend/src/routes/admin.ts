import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { asyncHandler } from '../lib/asyncHandler'
import { pool } from '../db/connection'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  getDailyUsage, getUsageByTeacher, getTodayCost,
  getUsageByFeature, getUsageByModel, getRecentErrors,
} from '../db/queries/usageLog'
import { upgradeTeacherToPro, cancelTeacherSubscription } from '../db/queries/teachers'
import { invalidateSpendCapCache } from '../services/spendCap'
import { sendEmail } from '../services/emailTransport'
import { proGrantedEmail } from '../lib/emailTemplates'
import {
  listInstitutionsWithCounts, createInstitution, updateInstitution,
  getSamlConfig, setSamlConfig,
} from '../db/queries/institutions'
import {
  listInstitutionContracts, createInstitutionContract,
  updateInstitutionContract, deleteInstitutionContract,
} from '../db/queries/institutionContracts'
import { syncRoleToTree, clearOrgTiesOutsideInstitution, assignDefaultDepartmentIfUnset } from '../db/queries/orgUnits'
import { metadataUrlForInstitution, acsUrlForInstitution } from '../services/saml'
import { listFeedback } from '../db/queries/feedback'
import { listContactMessages, markContactMessageRead } from '../db/queries/contactMessages'
import { listAudit } from '../db/queries/audit'
import { getFunnelSummary, getFunnelByWeek, getStalledTeachers } from '../db/queries/activation'
import { listDeploymentsSummary } from '../db/queries/controlPlane'
import {
  findPaymentsByTeacher, findPaymentByOrderId, markPaymentRefunded,
  listAllPayments, getPaymentsSummary, getRevenueByMonth,
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
        -- TODO.md Feature AL Phase 0 — this used to filter on created_at, which
        -- counts SIGNUPS this week, not active users (new_this_month below is
        -- the same metric on a wider window — that was the tell). last_seen_at
        -- (migration 073, touched on every authenticated request) is the real
        -- activity signal; COALESCE covers accounts that predate that column.
        COUNT(*) FILTER (WHERE COALESCE(last_seen_at, created_at) >= NOW() - INTERVAL '7 days') AS active_this_week,
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

// ─── GET /api/admin/usage/by-model?days=30 ───────────────────────────────────
// Provider/model breakdown (DeepSeek flash vs pro, Qwen plus vs max, etc.) —
// parsed from the "<provider>:<model-id>" string every LLMProvider logs.

router.get('/usage/by-model', asyncHandler(async (req, res) => {
  const days = parseInt((req.query.days as string) ?? '30', 10)
  res.json(await getUsageByModel(Math.min(days, 365)))
}))

// ─── GET /api/admin/errors?days=7 ────────────────────────────────────────────

router.get('/errors', asyncHandler(async (req, res) => {
  const days = parseInt((req.query.days as string) ?? '7', 10)
  res.json(await getRecentErrors(Math.min(days, 90)))
}))

// ─── Fleet — control-plane deployment registry (docs/on-prem-deployment.md
// §16 Track 1.7) ────────────────────────────────────────────────────────────
router.get('/deployments', asyncHandler(async (_req, res) => {
  res.json(await listDeploymentsSummary())
}))

// ─── Business metrics — payments & renewals ───────────────────────────────────
// Platform-wide view over the payments table. Renewal charges carry the
// `rb_` order-id prefix (renewals.ts); grace state lives on teachers.

router.get('/payments/summary', asyncHandler(async (req, res) => {
  const months = parseInt((req.query.months as string) ?? '12', 10)
  const [summary, byMonth] = await Promise.all([
    getPaymentsSummary(),
    getRevenueByMonth(Math.min(months, 36)),
  ])
  res.json({ summary, byMonth })
}))

router.get('/payments', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>
  const status = q.status && ['pending', 'confirmed', 'rejected', 'refunded'].includes(q.status)
    ? q.status : undefined
  res.json(await listAllPayments({
    status,
    limit:  Math.min(q.limit ? parseInt(q.limit, 10) : 50, 200),
    offset: q.offset ? parseInt(q.offset, 10) : 0,
  }))
}))

// ─── Activation funnel ────────────────────────────────────────────────────────
// Derived from courses/assignments/presentations MIN(created_at) — see
// db/queries/activation.ts. Summary + weekly cohorts + stalled-user triage list.

router.get('/activation/funnel', asyncHandler(async (req, res) => {
  const weeks = parseInt((req.query.weeks as string) ?? '12', 10)
  const [summary, cohorts] = await Promise.all([
    getFunnelSummary(),
    getFunnelByWeek(Math.min(weeks, 52)),
  ])
  res.json({ summary, cohorts })
}))

router.get('/activation/stalled', asyncHandler(async (req, res) => {
  const limit = parseInt((req.query.limit as string) ?? '100', 10)
  res.json(await getStalledTeachers(Math.min(limit, 500)))
}))

// ─── Cross-institution activity log ───────────────────────────────────────────
// Platform-admin view over every recorded user action. Optional filters:
// institutionId, actorTeacherId, action, from/to (ISO), plus limit/offset.
// Returns { rows, total } for pagination.

router.get('/audit', asyncHandler(async (req, res) => {
  const q = req.query as Record<string, string | undefined>
  res.json(await listAudit({
    institutionId:  q.institutionId  || undefined,
    actorTeacherId: q.actorTeacherId || undefined,
    action:         q.action         || undefined,
    from:           q.from           || undefined,
    to:             q.to             || undefined,
    limit:  q.limit  ? parseInt(q.limit, 10)  : 100,
    offset: q.offset ? parseInt(q.offset, 10) : 0,
  }))
}))

// ─── Edit-distance / AI quality signal ────────────────────────────────────────
// Aggregate of the assignment_edits view: how far teachers, in practice, edit
// the AI draft. Sliced by 30 / 90 day windows. Low score_delta + high
// bullets_kept means the AI is in sync with the teacher base.

router.get('/edit-distance', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query<{
    n_total:                 string
    mean_score_delta_30d:    string | null
    mean_score_delta_90d:    string | null
    pct_feedback_changed_30d: string | null
    mean_strengths_kept_30d:  string | null
    mean_improvements_kept_30d: string | null
    n_30d:                   string
    n_90d:                   string
  }>(
    `SELECT
       COUNT(*)                                                       AS n_total,
       AVG(CASE WHEN approved_at >= NOW() - INTERVAL '30 days' THEN score_delta::float END) AS mean_score_delta_30d,
       AVG(CASE WHEN approved_at >= NOW() - INTERVAL '90 days' THEN score_delta::float END) AS mean_score_delta_90d,
       AVG(CASE WHEN approved_at >= NOW() - INTERVAL '30 days' THEN feedback_changed::float END) AS pct_feedback_changed_30d,
       AVG(CASE WHEN approved_at >= NOW() - INTERVAL '30 days' THEN strengths_kept_pct END) AS mean_strengths_kept_30d,
       AVG(CASE WHEN approved_at >= NOW() - INTERVAL '30 days' THEN improvements_kept_pct END) AS mean_improvements_kept_30d,
       COUNT(*) FILTER (WHERE approved_at >= NOW() - INTERVAL '30 days') AS n_30d,
       COUNT(*) FILTER (WHERE approved_at >= NOW() - INTERVAL '90 days') AS n_90d
     FROM assignment_edits`
  )
  const r = rows[0]
  const round1 = (s: string | null) => s == null ? null : Math.round(Number(s) * 10) / 10
  const pct    = (s: string | null) => s == null ? null : Math.round(Number(s) * 1000) / 10
  res.json({
    n_total:                    Number(r.n_total),
    n_30d:                      Number(r.n_30d),
    n_90d:                      Number(r.n_90d),
    mean_score_delta_30d:       round1(r.mean_score_delta_30d),
    mean_score_delta_90d:       round1(r.mean_score_delta_90d),
    pct_feedback_changed_30d:   pct(r.pct_feedback_changed_30d),
    mean_strengths_kept_30d:    pct(r.mean_strengths_kept_30d),
    mean_improvements_kept_30d: pct(r.mean_improvements_kept_30d),
  })
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
              t.monthly_spend_cap_usd,
              COUNT(a.id)::int AS grade_count,
              ROUND(COALESCE(u.month_cost, 0)::numeric, 4) AS month_spend_usd
       FROM teachers t
       LEFT JOIN assignments a  ON a.teacher_id = t.id
       LEFT JOIN institutions i ON i.id = t.institution_id
       LEFT JOIN (
         SELECT teacher_id, SUM(cost_usd) AS month_cost
           FROM api_usage_log
          WHERE created_at >= date_trunc('month', NOW())
          GROUP BY teacher_id
       ) u ON u.teacher_id = t.id
       ${where}
       GROUP BY t.id, i.name, u.month_cost
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
    monthly_spend_cap_usd?: number | null
  }
  const { role, plan_tier, is_active } = body
  // institution_id is explicit: '' / null → unassign, uuid → assign, absent → leave
  const hasInstitution = Object.prototype.hasOwnProperty.call(body, 'institution_id')
  const institutionId  = body.institution_id ? body.institution_id : null

  // monthly_spend_cap_usd is explicit too: null → reset to plan-tier default,
  // a number → override, absent → leave untouched.
  const hasSpendCap = Object.prototype.hasOwnProperty.call(body, 'monthly_spend_cap_usd')
  if (hasSpendCap && body.monthly_spend_cap_usd != null) {
    const cap = Number(body.monthly_spend_cap_usd)
    if (!Number.isFinite(cap) || cap < 0) {
      throw new ValidationError('Лимит расходов должен быть неотрицательным числом')
    }
  }
  const spendCapValue = hasSpendCap && body.monthly_spend_cap_usd != null ? Number(body.monthly_spend_cap_usd) : null

  // Previous institution — needed to detect a real move so we can clear the
  // teacher's org-tree ties (roles + primary unit) in the old institution.
  const { rows: prevRows } = await pool.query<{ institution_id: string | null }>(
    'SELECT institution_id FROM teachers WHERE id = $1',
    [req.params.id]
  )
  if (!prevRows[0]) { res.status(404).json({ error: 'Преподаватель не найден' }); return }
  const prevInstitutionId = prevRows[0].institution_id

  const { rows } = await pool.query(
    `UPDATE teachers
     SET role                  = COALESCE($2, role),
         plan_tier             = COALESCE($3, plan_tier),
         is_active             = COALESCE($4, is_active),
         institution_id        = CASE WHEN $5 THEN $6 ELSE institution_id END,
         monthly_spend_cap_usd = CASE WHEN $7 THEN $8 ELSE monthly_spend_cap_usd END
     WHERE id = $1
     RETURNING id, email, name, role, plan_tier, is_active, institution_id, monthly_spend_cap_usd`,
    [req.params.id, role ?? null, plan_tier ?? null, is_active ?? null, hasInstitution, institutionId, hasSpendCap, spendCapValue]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Преподаватель не найден' }); return }
  if (hasSpendCap) invalidateSpendCapCache(req.params.id)

  // A real institution move (or detach) invalidates every org-tree tie the
  // teacher held in the old institution: unit roles would otherwise keep
  // granting leadership/programme visibility there, and the stale primary
  // department would keep them drillable by the old org's heads. Clear before
  // syncRoleToTree so a role sync re-grants admin-on-root in the NEW tree only.
  const institutionMoved = hasInstitution && prevInstitutionId !== rows[0].institution_id
  if (institutionMoved) {
    await clearOrgTiesOutsideInstitution(rows[0].id, rows[0].institution_id)
    // Moved into an institution → land in its default kafedra (same rule as
    // registration) so the teacher is immediately visible in the new tree.
    if (rows[0].institution_id) {
      await assignDefaultDepartmentIfUnset(rows[0].id, rows[0].institution_id)
    }
  }

  // Keep the §7 org tree authoritative: when the role changes, mirror it into
  // is_platform_admin + admin-on-root so the (tree-based) guards stay correct.
  // Also re-run on an institution move even if `role` wasn't part of this PATCH —
  // clearOrgTiesOutsideInstitution just wiped any admin-on-root grant the teacher
  // held in the old tree, and skipping this left a teacher.role of
  // 'institution_admin' (badge still shows «админ») with no matching grant in
  // the new institution: is_institution_admin comes back false, «Организация»
  // and every /institution route stay blocked until someone happens to also
  // touch role in a later PATCH. Confirmed against a real support report.
  if (role !== undefined || institutionMoved) {
    await syncRoleToTree(rows[0].id, rows[0].role, rows[0].institution_id)
  }

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
    'SELECT id, email, name, plan_tier, plan_expires_at FROM teachers WHERE id = $1',
    [req.params.id]
  )

  // Congratulations email — only from the freebie grant path (the paid path in
  // paymentFulfillment sends its own receipt). Fire-and-forget so a Unisender
  // hiccup doesn't fail the admin's grant action; status surfacing for this
  // one is not worth a schema column.
  const t = fresh[0]
  if (t?.email && t.plan_expires_at) {
    sendEmail({
      ...proGrantedEmail(t.name ?? t.email, days, new Date(t.plan_expires_at)),
      to: t.email,
    })
  }

  res.json(t)
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

// ─── Contact messages (marketing-site inbox) ──────────────────────────────────

router.get('/contact-messages', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '200', 10) || 200, 500)
  res.json(await listContactMessages(limit))
}))

router.patch('/contact-messages/:id/read', asyncHandler(async (req, res) => {
  const row = await markContactMessageRead(req.params.id)
  if (!row) throw new NotFoundError('Обращение')
  res.json(row)
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

// ─── SAML config (platform admin only) ────────────────────────────────────────
// Institution admin will get a scoped version of these later; for v1 only
// platform admin can configure SAML so we can hand-hold the first pilots.

router.get('/institutions/:id/saml', asyncHandler(async (req, res) => {
  const cfg = await getSamlConfig(req.params.id)
  if (!cfg) throw new NotFoundError('Организация')
  res.json({
    ...cfg,
    // URLs the IdP admin needs to configure their side
    spEntityId:  process.env.SAML_SP_ENTITY_ID ?? null,
    metadataUrl: metadataUrlForInstitution(req.params.id),
    acsUrl:      acsUrlForInstitution(req.params.id),
  })
}))

router.put('/institutions/:id/saml', asyncHandler(async (req, res) => {
  const b = req.body as Partial<{
    saml_enabled:         boolean
    saml_idp_entity_id:   string | null
    saml_idp_sso_url:     string | null
    saml_idp_x509_cert:   string | null
    saml_attribute_email: string
    saml_attribute_name:  string
    saml_force_sso:       boolean
  }>

  // Light validation — full validation lives in the discovery/login endpoints
  // which fail closed if config is incomplete. Here we just sanity-check types.
  if (b.saml_idp_sso_url && !/^https?:\/\//i.test(b.saml_idp_sso_url)) {
    throw new ValidationError('SSO URL должен начинаться с http(s)://')
  }
  if (b.saml_idp_x509_cert && !b.saml_idp_x509_cert.includes('-----BEGIN CERTIFICATE-----')) {
    throw new ValidationError('Сертификат должен быть в формате PEM')
  }

  const updated = await setSamlConfig(req.params.id, b)
  if (!updated) throw new NotFoundError('Организация')
  res.json(updated)
}))

// ─── Institution contracts (TODO.md Feature AL Phase 0) ───────────────────────
// Manual record of negotiated institution deals — institution revenue
// doesn't exist anywhere else in the database (payments.ts is
// teacher-scoped only), and these deals are negotiated offline via 44-ФЗ
// procurement, so there's no payment webhook to derive this from.

router.get('/institutions/:id/contracts', asyncHandler(async (req, res) => {
  res.json(await listInstitutionContracts(req.params.id))
}))

function parseIsoDate(v: unknown, field: string): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new ValidationError(`${field}: укажите дату в формате ГГГГ-ММ-ДД`)
  }
  return v
}

router.post('/institutions/:id/contracts', asyncHandler(async (req, res) => {
  const { annual_value_rub, seats_purchased, term_start, term_end, notes } = req.body as {
    annual_value_rub?: unknown; seats_purchased?: unknown
    term_start?: unknown; term_end?: unknown; notes?: unknown
  }

  const annualValueRub = Number(annual_value_rub)
  if (!Number.isFinite(annualValueRub) || annualValueRub < 0) {
    throw new ValidationError('Сумма контракта должна быть неотрицательным числом')
  }
  const seatsPurchased = Number(seats_purchased)
  if (!Number.isInteger(seatsPurchased) || seatsPurchased < 1) {
    throw new ValidationError('Количество мест должно быть положительным целым числом')
  }
  const termStart = parseIsoDate(term_start, 'Начало срока')
  const termEnd   = parseIsoDate(term_end, 'Конец срока')
  if (termEnd <= termStart) throw new ValidationError('Конец срока должен быть позже начала')

  res.status(201).json(await createInstitutionContract({
    institutionId:  req.params.id,
    annualValueRub, seatsPurchased, termStart, termEnd,
    notes: typeof notes === 'string' ? notes.trim() || null : null,
    createdBy: req.teacher.id,
  }))
}))

router.patch('/institutions/:id/contracts/:contractId', asyncHandler(async (req, res) => {
  const { annual_value_rub, seats_purchased, term_start, term_end, notes } = req.body as {
    annual_value_rub?: unknown; seats_purchased?: unknown
    term_start?: unknown; term_end?: unknown; notes?: unknown
  }

  const patch: Parameters<typeof updateInstitutionContract>[1] = {}
  if (annual_value_rub !== undefined) {
    const v = Number(annual_value_rub)
    if (!Number.isFinite(v) || v < 0) throw new ValidationError('Сумма контракта должна быть неотрицательным числом')
    patch.annualValueRub = v
  }
  if (seats_purchased !== undefined) {
    const v = Number(seats_purchased)
    if (!Number.isInteger(v) || v < 1) throw new ValidationError('Количество мест должно быть положительным целым числом')
    patch.seatsPurchased = v
  }
  if (term_start !== undefined) patch.termStart = parseIsoDate(term_start, 'Начало срока')
  if (term_end   !== undefined) patch.termEnd   = parseIsoDate(term_end, 'Конец срока')
  if (patch.termStart && patch.termEnd && patch.termEnd <= patch.termStart) {
    throw new ValidationError('Конец срока должен быть позже начала')
  }
  if (notes !== undefined) patch.notes = typeof notes === 'string' ? notes.trim() || null : null

  const updated = await updateInstitutionContract(req.params.contractId, patch)
  if (!updated) throw new NotFoundError('Контракт')
  res.json(updated)
}))

router.delete('/institutions/:id/contracts/:contractId', asyncHandler(async (req, res) => {
  const deleted = await deleteInstitutionContract(req.params.contractId)
  if (!deleted) throw new NotFoundError('Контракт')
  res.status(204).end()
}))

export default router
