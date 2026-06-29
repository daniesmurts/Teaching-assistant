import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import {
  createPublishedAssignmentRules, updatePublishedAssignmentRules, addInviteRules,
} from '../validation/publishedAssignmentValidation'
import {
  createPublishedAssignment, getPublishedAssignment, listPublishedAssignments,
  updatePublishedAssignment, addInvite, listInvites, deleteInvite,
  getSubmissionForTeacher,
} from '../db/queries/publishedAssignments'
import { tiptapToText } from '../lib/tiptapText'
import { computeProvenance } from '../services/provenance'
import type { SubmissionTelemetry } from '../../../shared/types'

// Teacher-side publish backend (Feature Q1). Mounted at /api/published-assignments.
// Gated to Pro/Institution via the publishedAssignments plan flag — Free tier
// stays on the legacy copy/paste grading flow. The public student writing surface
// (/write/:token) is a separate, token-authenticated route group (Q3).

const router = Router()
router.use(authenticate)
router.use(checkFeatureAccess('publishedAssignments'))

// Load a definition owned by the caller, or 404.
async function ownedAssignment(id: string, teacherId: string) {
  const pa = await getPublishedAssignment(id, teacherId)
  if (!pa) throw new NotFoundError('Задание')
  return pa
}

// ─── Definitions ──────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  res.json({ assignments: await listPublishedAssignments(req.teacher.id) })
}))

router.post('/', validate(createPublishedAssignmentRules), asyncHandler(async (req, res) => {
  const { title, instructions, course_id, rubric_id, due_at } = req.body
  const pa = await createPublishedAssignment({
    teacherId:    req.teacher.id,
    courseId:     course_id ?? null,
    rubricId:     rubric_id ?? null,
    title:        title.trim(),
    instructions: instructions?.trim() || null,
    dueAt:        due_at ?? null,
  })
  res.status(201).json(pa)
}))

router.get('/:id', asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)
  res.json({ assignment: pa, invites: await listInvites(pa.id) })
}))

router.patch('/:id', validate(updatePublishedAssignmentRules), asyncHandler(async (req, res) => {
  await ownedAssignment(req.params.id, req.teacher.id)
  const updated = await updatePublishedAssignment(req.params.id, req.teacher.id, {
    title:        req.body.title?.trim(),
    instructions: req.body.instructions !== undefined ? (req.body.instructions?.trim() || null) : undefined,
    dueAt:        req.body.due_at !== undefined ? (req.body.due_at || null) : undefined,
    status:       req.body.status,
  })
  if (!updated) throw new NotFoundError('Задание')
  res.json(updated)
}))

// ─── Invites (roster) ─────────────────────────────────────────────────────────

router.post('/:id/invites', validate(addInviteRules), asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)
  const invite = await addInvite(pa.id, {
    studentName:  req.body.student_name?.trim() || null,
    studentEmail: req.body.student_email || null,
  })
  res.status(201).json(invite)
}))

router.delete('/:id/invites/:inviteId', asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)
  const ok = await deleteInvite(req.params.inviteId, pa.id)
  if (!ok) throw new ValidationError('Нельзя удалить: приглашение не найдено или работа уже сдана')
  res.status(204).end()
}))

// ─── Submission review + provenance (Q4) ──────────────────────────────────────

router.get('/:id/submissions/:inviteId', asyncHandler(async (req, res) => {
  const sub = await getSubmissionForTeacher(req.params.id, req.params.inviteId, req.teacher.id)
  if (!sub) throw new NotFoundError('Работа')
  res.json({
    student_name:  sub.student_name,
    student_email: sub.student_email,
    submitted_at:  sub.submitted_at,
    submission_text: tiptapToText(sub.draft_content),
    provenance:    computeProvenance(sub.submission_telemetry as SubmissionTelemetry | null),
  })
}))

export default router
