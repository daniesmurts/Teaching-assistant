import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { normaliseInviteNames } from '../lib/inviteNames'
import { NotFoundError, ValidationError } from '../errors/AppError'
import {
  createPublishedAssignmentRules, updatePublishedAssignmentRules, addInviteRules, addInvitesBulkRules,
} from '../validation/publishedAssignmentValidation'
import {
  createPublishedAssignment, getPublishedAssignment, listPublishedAssignments,
  updatePublishedAssignment, addInvite, addInvitesBulk, listInvites, deleteInvite,
  getSubmissionForTeacher, attachSubmissionToGrade, type SubmittedInvite,
} from '../db/queries/publishedAssignments'
import { findLtiCourseLinkByCourseId } from '../db/queries/ltiCourseLinks'
import { getLtiConfig } from '../db/queries/institutions'
import { fetchRoster } from '../services/ltiServices'
import { getCohortSynthesis } from '../db/queries/cohortSyntheses'
import { synthesizeCohort } from '../services/cohortSynthesis'
import { tiptapToText } from '../lib/tiptapText'
import { computeProvenance } from '../services/provenance'
import { grade } from '../services/grading'
import { aiLimiter } from '../middleware/rateLimits'
import type { SubmissionTelemetry } from '../../../shared/types'

// Shape the inline grade summary shown on the submission-review page. null until
// the teacher grades; final review/approval happens in the Журнал (the row is an
// ordinary assignment, now carrying published_assignment_id + telemetry).
function gradeView(s: SubmittedInvite) {
  if (!s.assignment_id) return null
  return {
    assignment_id:  s.assignment_id,
    ai_score:       s.ai_score,
    ai_grade:       s.ai_grade,
    ai_grade_label: s.ai_grade_label,
    ai_feedback:    s.ai_feedback,
    ai_strengths:   s.ai_strengths ?? [],
    ai_improvements: s.ai_improvements ?? [],
    status:         s.grade_status,
  }
}

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

// POST /:id/invites/bulk — paste a group, get a personal link per student.
// Adding students one at a time was the only path, which for a 30-person
// group meant 30 rounds of type-name-click-add before a single link existed —
// reported as "no way to get the link to share with the students".
router.post('/:id/invites/bulk', validate(addInvitesBulkRules), asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)

  const names = normaliseInviteNames(req.body.names)
  if (names.length === 0) throw new ValidationError('В списке нет ни одного имени')

  const invites = await addInvitesBulk(pa.id, names)
  res.status(201).json({ invites })
}))

router.delete('/:id/invites/:inviteId', asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)
  const ok = await deleteInvite(req.params.inviteId, pa.id)
  if (!ok) throw new ValidationError('Нельзя удалить: приглашение не найдено или работа уже сдана')
  res.status(204).end()
}))

// ─── Moodle roster import (NRPS) ───────────────────────────────────────────────
// Only available when the assignment's course was itself created from an LTI
// launch and the institution's NRPS membership URL was captured at that
// launch — a silent { available: false } otherwise, no error.

router.get('/:id/lti-roster', asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)
  const link = pa.course_id ? await findLtiCourseLinkByCourseId(pa.course_id) : null
  if (!link?.nrps_context_memberships_url) {
    res.json({ available: false })
    return
  }

  const cfg = await getLtiConfig(link.institution_id)
  if (!cfg) {
    res.json({ available: false })
    return
  }

  const members = await fetchRoster(cfg, link.nrps_context_memberships_url)
  res.json({ available: true, members })
}))

router.post('/:id/lti-roster/import', asyncHandler(async (req, res) => {
  const pa = await ownedAssignment(req.params.id, req.teacher.id)
  const link = pa.course_id ? await findLtiCourseLinkByCourseId(pa.course_id) : null
  if (!link?.nrps_context_memberships_url) {
    throw new ValidationError('Список студентов Moodle недоступен для этого курса')
  }

  const { members } = req.body as { members?: Array<{ userId: string; name: string | null; email: string | null }> }
  if (!Array.isArray(members) || members.length === 0) {
    throw new ValidationError('Выберите хотя бы одного студента')
  }

  const invites = []
  for (const m of members) {
    invites.push(await addInvite(pa.id, { studentName: m.name, studentEmail: m.email }))
  }
  res.status(201).json({ invites })
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
    grade:         gradeView(sub),
  })
}))

// Grade a submitted work with AI. Materialises the gradeable assignment via the
// existing grader, then attaches the published-assignment provenance + links the
// invite. Holistic for v1 (published assignments don't yet carry criteria).
router.post('/:id/submissions/:inviteId/grade', aiLimiter, asyncHandler(async (req, res) => {
  const sub = await getSubmissionForTeacher(req.params.id, req.params.inviteId, req.teacher.id)
  if (!sub) throw new NotFoundError('Работа')

  if (sub.assignment_id) { res.json(gradeView(sub)); return }   // already graded — idempotent

  const text = tiptapToText(sub.draft_content)
  if (text.length < 1) throw new ValidationError('Нельзя проверить пустую работу')

  const result = await grade({
    teacherId:      req.teacher.id,
    institutionId:  req.teacher.institution_id,
    planTier:       req.teacher.plan_tier,
    submissionText: text,
    courseId:       sub.course_id ?? undefined,
    studentName:    sub.student_name ?? undefined,
    studentEmail:   sub.student_email ?? undefined,
  })

  await attachSubmissionToGrade(
    result.assignment_id, req.params.inviteId, req.params.id,
    sub.submission_telemetry, sub.submitted_at,
  )

  res.status(201).json({
    assignment_id:   result.assignment_id,
    ai_score:        result.ai_score,
    ai_grade:        result.ai_grade,
    ai_grade_label:  result.ai_grade_label,
    ai_feedback:     result.ai_feedback,
    ai_strengths:    result.ai_strengths,
    ai_improvements: result.ai_improvements,
    status:          'pending',
  })
}))

// ─── Cohort synthesis (class-wide insight, §5.1) ───────────────────────────────

router.get('/:id/synthesis', checkFeatureAccess('cohortSynthesis'), asyncHandler(async (req, res) => {
  await ownedAssignment(req.params.id, req.teacher.id)
  res.json(await getCohortSynthesis(req.params.id))
}))

router.post('/:id/synthesize', checkFeatureAccess('cohortSynthesis'), aiLimiter, asyncHandler(async (req, res) => {
  await ownedAssignment(req.params.id, req.teacher.id)
  const result = await synthesizeCohort(req.params.id, req.teacher.id)
  res.json(result)
}))

export default router
