import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { findCourseById } from '../db/queries/courses'
import { resolveCourseText } from './curriculum'
import { extractBrsDraft, computeStudentAccrual, type BrsDraft } from '../services/brsScheme'
import { findStudentsByTeacher } from '../db/queries/assignments'
import {
  getBrsSchemeForCourse, getBrsSchemeById, createBrsSchemeDraft, publishBrsScheme, addBrsManualEntry,
  getScoredRowsForScheme, getManualRowsForScheme,
  type BrsSchemePayload, type BrsSchemeWithCheckpoints,
} from '../db/queries/brs'

// Feature AE v1 (TODO.md "### AE") — БРС engine. Per-course teacher data
// (findCourseById ownership check on every route), not platform reference
// data — no requireAdmin anywhere in this file, unlike routes/adminFgos.ts.

const router = Router()
router.use(authenticate)
router.use(checkFeatureAccess('brsEngine'))

function payloadFromBody(body: unknown): BrsSchemePayload {
  const b = body as Partial<BrsDraft> & { source_excerpt?: string | null }
  if (!b || typeof b !== 'object' || !Array.isArray(b.checkpoints)) {
    throw new ValidationError('Некорректные данные схемы БРС')
  }
  return {
    title:           b.title ?? null,
    source_excerpt:  b.source_excerpt ?? null,
    checkpoints:     b.checkpoints.map((c) => ({
      name:                 String(c.name ?? '').trim(),
      max_points:           Number(c.max_points) || 0,
      checkpoint_type:      (c.checkpoint_type === 'manual' ? 'manual' : 'graded') as 'graded' | 'manual',
      is_verbatim_verified: Boolean(c.is_verbatim_verified),
    })).filter((c) => c.name),
    gradeThresholds: (b.gradeThresholds ?? []).map((t) => ({
      min_points:  Number(t.min_points) || 0,
      max_points:  Number(t.max_points) || 0,
      grade_label: String(t.grade_label ?? '').trim(),
    })).filter((t) => t.grade_label),
  }
}

async function requireOwnedCourse(courseId: string, teacherId: string) {
  const course = await findCourseById(courseId, teacherId)
  if (!course) throw new NotFoundError('Дисциплина')
  return course
}

async function schemeToDraft(scheme: BrsSchemeWithCheckpoints): Promise<BrsDraft & { id: string; status: string; version: number }> {
  return {
    id:      scheme.id,
    status:  scheme.status,
    version: scheme.version,
    title:   scheme.title,
    checkpoints: scheme.checkpoints.map((c) => ({
      id:                   c.id,
      name:                 c.name,
      max_points:           Number(c.max_points),
      checkpoint_type:      c.checkpoint_type,
      is_verbatim_verified: c.is_verbatim_verified,
    })),
    gradeThresholds: scheme.grade_thresholds,
  }
}

// ─── Extract (no DB write) ──────────────────────────────────────────────────

router.post('/extract', asyncHandler(async (req, res) => {
  const courseId = String(req.body.course_id ?? '').trim()
  if (!courseId) throw new ValidationError('Укажите предмет')
  await requireOwnedCourse(courseId, req.teacher.id)

  const { text } = await resolveCourseText(courseId, req.teacher.id)
  const draft = await extractBrsDraft(text)
  res.json(draft)
}))

// ─── Read ────────────────────────────────────────────────────────────────────

router.get('/course/:courseId', asyncHandler(async (req, res) => {
  await requireOwnedCourse(req.params.courseId, req.teacher.id)
  const scheme = await getBrsSchemeForCourse(req.params.courseId, req.teacher.id)
  res.json(scheme ? await schemeToDraft(scheme) : null)
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const scheme = await getBrsSchemeById(req.params.id, req.teacher.id)
  if (!scheme) throw new NotFoundError('Схема БРС')
  res.json(await schemeToDraft(scheme))
}))

// ─── Create draft / publish ─────────────────────────────────────────────────

router.post('/', asyncHandler(async (req, res) => {
  const courseId = String(req.body.course_id ?? '').trim()
  if (!courseId) throw new ValidationError('Укажите предмет')
  await requireOwnedCourse(courseId, req.teacher.id)

  const payload = payloadFromBody(req.body)
  const scheme = await createBrsSchemeDraft(courseId, req.teacher.id, payload)
  res.status(201).json(await schemeToDraft(scheme))
}))

router.post('/:id/publish', asyncHandler(async (req, res) => {
  const payload = payloadFromBody(req.body)
  const scheme = await publishBrsScheme(req.params.id, req.teacher.id, payload)
  if (!scheme) throw new NotFoundError('Схема БРС')
  res.json(await schemeToDraft(scheme))
}))

// ─── Manual entries (посещение/активность-type checkpoints) ────────────────

router.post('/:id/manual-entry', asyncHandler(async (req, res) => {
  const scheme = await getBrsSchemeById(req.params.id, req.teacher.id)
  if (!scheme) throw new NotFoundError('Схема БРС')

  const checkpointId = String(req.body.checkpoint_id ?? '').trim()
  const studentName  = String(req.body.student_name ?? '').trim()
  const points       = Number(req.body.points)
  if (!checkpointId || !scheme.checkpoints.some((c) => c.id === checkpointId)) {
    throw new ValidationError('Неверная контрольная точка')
  }
  if (!studentName) throw new ValidationError('Укажите имя студента')
  if (!Number.isFinite(points)) throw new ValidationError('Укажите количество баллов')

  await addBrsManualEntry({
    checkpointId,
    teacherId:    req.teacher.id,
    studentName,
    studentGroup: req.body.student_group ? String(req.body.student_group).trim() : null,
    points,
    note:         req.body.note ? String(req.body.note).trim() : null,
  })
  res.status(201).json({ ok: true })
}))

// ─── Ledger ──────────────────────────────────────────────────────────────────

router.get('/course/:courseId/ledger', asyncHandler(async (req, res) => {
  await requireOwnedCourse(req.params.courseId, req.teacher.id)
  const scheme = await getBrsSchemeForCourse(req.params.courseId, req.teacher.id)
  if (!scheme || scheme.status !== 'published') { res.json([]); return }

  const [scoredRows, manualRows, students] = await Promise.all([
    getScoredRowsForScheme(scheme.id, req.teacher.id),
    getManualRowsForScheme(scheme.id, req.teacher.id),
    findStudentsByTeacher(req.teacher.id, req.params.courseId),
  ])

  const accrualScheme = {
    checkpoints: scheme.checkpoints.map((c) => ({
      id: c.id, name: c.name, max_points: Number(c.max_points),
      checkpoint_type: c.checkpoint_type, is_verbatim_verified: c.is_verbatim_verified,
    })),
    gradeThresholds: scheme.grade_thresholds,
  }

  const ledger = students.map((s) => ({
    student_name:  s.student_name,
    student_group: s.student_group,
    ...computeStudentAccrual(
      accrualScheme,
      scoredRows.filter((r) => r.student_name === s.student_name && r.student_group === s.student_group),
      manualRows.filter((r) => r.student_name === s.student_name && r.student_group === s.student_group),
    ),
  }))

  res.json(ledger)
}))

router.get('/course/:courseId/ledger/:studentName', asyncHandler(async (req, res) => {
  await requireOwnedCourse(req.params.courseId, req.teacher.id)
  const scheme = await getBrsSchemeForCourse(req.params.courseId, req.teacher.id)
  if (!scheme || scheme.status !== 'published') { res.json(null); return }

  const studentGroup = (req.query.student_group as string | undefined) ?? null
  const [scoredRows, manualRows] = await Promise.all([
    getScoredRowsForScheme(scheme.id, req.teacher.id),
    getManualRowsForScheme(scheme.id, req.teacher.id),
  ])

  const accrualScheme = {
    checkpoints: scheme.checkpoints.map((c) => ({
      id: c.id, name: c.name, max_points: Number(c.max_points),
      checkpoint_type: c.checkpoint_type, is_verbatim_verified: c.is_verbatim_verified,
    })),
    gradeThresholds: scheme.grade_thresholds,
  }

  const accrual = computeStudentAccrual(
    accrualScheme,
    scoredRows.filter((r) => r.student_name === req.params.studentName && (r.student_group ?? null) === studentGroup),
    manualRows.filter((r) => r.student_name === req.params.studentName && (r.student_group ?? null) === studentGroup),
  )
  res.json(accrual)
}))

export default router
