import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { checkResourceLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { createCourseRules, updateCourseRules } from '../validation/courseValidation'
import {
  findCoursesByTeacher, findCourseById, createCourse, updateCourse, deleteCourse,
} from '../db/queries/courses'
import { getPolicyMemo } from '../db/queries/policyMemos'
import { generatePolicyMemo } from '../services/policyMemo'
import { findLectureTopics, replaceLectureTopics } from '../db/queries/lectureTopics'
import { extractLecturePlan } from '../services/lecturePlan'
import { aiLimiter } from '../middleware/rateLimits'

const router = Router()
router.use(authenticate)

router.get('/', asyncHandler(async (req, res) => {
  res.json(await findCoursesByTeacher(req.teacher.id))
}))

router.post(
  '/',
  checkResourceLimit('courses', 'maxCourses'),
  validate(createCourseRules),
  asyncHandler(async (req, res) => {
    const course = await createCourse(
      req.teacher.id,
      req.body as {
        name: string; code?: string; level?: string; syllabus_text?: string
        profession_context?: string
      }
    )
    res.status(201).json(course)
  })
)

router.get('/:id', asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')
  res.json(course)
}))

router.put('/:id', validate(updateCourseRules), asyncHandler(async (req, res) => {
  const course = await updateCourse(
    req.params.id, req.teacher.id,
    req.body as {
      name?: string; code?: string; level?: string; syllabus_text?: string
      profession_context?: string
      share_rag_with_institution?: boolean
    }
  )
  if (!course) throw new NotFoundError('Предмет')
  res.json(course)
}))

router.delete('/:id', asyncHandler(async (req, res) => {
  const deleted = await deleteCourse(req.params.id, req.teacher.id)
  if (!deleted) throw new NotFoundError('Предмет')
  res.status(204).send()
}))

router.get('/:id/policy-memo', checkFeatureAccess('ragFlywheel'), asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')
  res.json(await getPolicyMemo(req.params.id))
}))

router.post('/:id/policy-memo/regenerate', checkFeatureAccess('ragFlywheel'), asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')
  await generatePolicyMemo(req.params.id, req.teacher.id)
  res.json(await getPolicyMemo(req.params.id))
}))

// ─── Тематический план (TODO.md "### AO" Phase 3) ───────────────────────────
//
// The lecture list of a course, read out of its РПД once and then owned by the
// teacher — what the presentation form offers instead of asking them to retype
// a topic and its number for every deck.

router.get('/:id/lecture-plan', asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')
  res.json(await findLectureTopics(req.params.id, req.teacher.id))
}))

// Extraction is one LLM call over the programme text, run on demand rather
// than per generation: the programme is long and the plan changes about once a
// year, so re-reading it for every deck would pay repeatedly for an answer
// that doesn't move.
router.post('/:id/lecture-plan/extract', aiLimiter, asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')
  res.json(await extractLecturePlan({
    courseId:      req.params.id,
    teacherId:     req.teacher.id,
    institutionId: req.teacher.institution_id ?? undefined,
  }))
}))

// Wholesale replace — the plan is edited as a list (add, remove, reorder,
// retype), so a per-row PATCH would make the client reconcile positions the
// server is going to renumber anyway.
router.put('/:id/lecture-plan', asyncHandler(async (req, res) => {
  const course = await findCourseById(req.params.id, req.teacher.id)
  if (!course) throw new NotFoundError('Предмет')

  const raw = Array.isArray(req.body?.topics) ? req.body.topics : []
  const topics = raw
    .map((t: unknown) => {
      const o = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      const title = typeof o.title === 'string' ? o.title.trim() : ''
      const description = typeof o.description === 'string' ? o.description.trim() : ''
      return { title: title.slice(0, 200), description: description.slice(0, 600) || null, source: 'manual' as const }
    })
    .filter((t: { title: string }) => t.title.length > 0)
    .slice(0, 60)

  res.json(await replaceLectureTopics(req.params.id, req.teacher.id, topics))
}))

export default router
