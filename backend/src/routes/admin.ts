import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireAdmin } from '../middleware/requireRole'
import { asyncHandler } from '../lib/asyncHandler'
import { pool } from '../db/connection'
import {
  getDailyUsage, getUsageByTeacher, getTodayCost,
  getUsageByFeature, getRecentErrors,
} from '../db/queries/usageLog'

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

// ─── Global template rubrics ──────────────────────────────────────────────────

router.get('/rubrics/templates', asyncHandler(async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT id, name, criteria, template_subject, created_at
     FROM rubrics
     WHERE is_global_template = TRUE
     ORDER BY template_subject, name`
  )
  res.json(rows)
}))

router.post('/rubrics/templates', asyncHandler(async (req, res) => {
  const { name, criteria, template_subject } = req.body as {
    name: string; criteria: unknown; template_subject?: string
  }
  const { rows } = await pool.query(
    `INSERT INTO rubrics (teacher_id, name, criteria, is_global_template, template_subject)
     VALUES ($1, $2, $3, TRUE, $4)
     RETURNING id, name, criteria, template_subject, created_at`,
    [req.teacher.id, name, JSON.stringify(criteria), template_subject ?? 'general']
  )
  res.status(201).json(rows[0])
}))

router.delete('/rubrics/templates/:id', asyncHandler(async (req, res) => {
  const { rowCount } = await pool.query(
    'DELETE FROM rubrics WHERE id = $1 AND is_global_template = TRUE',
    [req.params.id]
  )
  if (!rowCount) { res.status(404).json({ error: 'Шаблон не найден' }); return }
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
              t.is_active, t.created_at,
              COUNT(a.id)::int AS grade_count
       FROM teachers t
       LEFT JOIN assignments a ON a.teacher_id = t.id
       ${where}
       GROUP BY t.id
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
  const { role, plan_tier, is_active } = req.body as {
    role?: string; plan_tier?: string; is_active?: boolean
  }
  const { rows } = await pool.query(
    `UPDATE teachers
     SET role        = COALESCE($2, role),
         plan_tier   = COALESCE($3, plan_tier),
         is_active   = COALESCE($4, is_active)
     WHERE id = $1
     RETURNING id, email, name, role, plan_tier, is_active`,
    [req.params.id, role ?? null, plan_tier ?? null, is_active ?? null]
  )
  if (!rows[0]) { res.status(404).json({ error: 'Преподаватель не найден' }); return }
  res.json(rows[0])
}))

export default router
