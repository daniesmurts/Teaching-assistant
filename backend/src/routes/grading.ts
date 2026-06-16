import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { gradeRules, approveRules, reviewRules } from '../validation/gradingValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { checkMonthlyLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { canUseFeature } from '../config/planLimits'
import { grade, approve } from '../services/grading'
import { runLongReview } from '../services/longReview'
import { createLongReview, getLongReviewById, getLongReviewByAssignmentId } from '../db/queries/longReviews'
import { generateEmailDraft } from '../services/email'
import { composeHandout } from '../services/handout'
import { searchFeedbackLibrary } from '../services/feedbackLibrary'
import { getCrossInstitutionUseCount } from '../db/queries/ragRetrievals'
import { findAssignmentsByTeacher, findStudentsByTeacher, findAssignmentsForExport, findAssignmentById, findApprovalHistory } from '../db/queries/assignments'
import { toCsv, csvFilename } from '../lib/csv'
import { pool } from '../db/connection'
import type { GradeLetter, BulletItem } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// POST /api/grading/grade
router.post(
  '/grade',
  aiLimiter,
  checkMonthlyLimit('gradesPerMonth'),
  validate(gradeRules),
  asyncHandler(async (req, res) => {
    const {
      submission_text, criterion_ids, weights, course_id,
      student_name, student_email, student_group,
      reference_solution, assignment_type, parent_assignment_id, thorough,
    } = req.body as {
      submission_text: string
      criterion_ids?: string[]
      weights?: number[]
      course_id?: string
      student_name?: string
      student_email?: string
      student_group?: string
      reference_solution?: string
      assignment_type?: 'essay' | 'calculation'
      parent_assignment_id?: string
      thorough?: boolean
    }
    // Thorough (confidence ensemble) is a Pro+ feature — silently downgrade to a
    // normal grade for free tier rather than erroring (the toggle is hidden in
    // the UI there anyway; this just guards a hand-crafted request).
    const thoroughAllowed = Boolean(thorough) && canUseFeature(req.teacher.plan_tier, 'confidenceCheck')

    const result = await grade({
      teacherId:          req.teacher.id,
      institutionId:      req.teacher.institution_id ?? null,
      planTier:           req.teacher.plan_tier,
      submissionText:     submission_text,
      criterionIds:       criterion_ids,
      weights,
      courseId:           course_id,
      studentName:        student_name,
      studentEmail:       student_email,
      studentGroup:       student_group,
      referenceSolution:  reference_solution,
      assignmentType:     assignment_type === 'calculation' ? 'calculation' : 'essay',
      parentAssignmentId: parent_assignment_id,
      thorough:           thoroughAllowed,
    })
    res.json(result)
  })
)

// POST /api/grading/review  — large works (ВКР/диплом) → async section-aware review.
// Pro-gated (same access as document upload) and counts toward the monthly grade quota.
router.post(
  '/review',
  aiLimiter,
  checkFeatureAccess('documentUpload'),
  checkMonthlyLimit('gradesPerMonth'),
  validate(reviewRules),
  asyncHandler(async (req, res) => {
    const {
      submission_text, criterion_ids, weights, course_id,
      student_name, student_email, student_group,
    } = req.body as {
      submission_text: string
      criterion_ids?: string[]
      weights?: number[]
      course_id?: string
      student_name?: string
      student_email?: string
      student_group?: string
    }

    const review = await createLongReview({
      teacherId:     req.teacher.id,
      courseId:      course_id,
      studentName:   student_name,
      studentEmail:  student_email,
      studentGroup:  student_group,
      submissionText: submission_text,
    })

    // Process asynchronously — do not await. The client polls GET /review/:id.
    runLongReview({
      reviewId:       review.id,
      teacherId:      req.teacher.id,
      institutionId:  req.teacher.institution_id ?? null,
      courseId:       course_id,
      criterionIds:   criterion_ids,
      weights,
      studentName:    student_name,
      studentEmail:   student_email,
      studentGroup:   student_group,
      submissionText: submission_text,
    }).catch(() => null)

    res.status(202).json({
      id:             review.id,
      status:         review.status,
      progress_done:  0,
      progress_total: 0,
      assignment_id:  null,
      result:         null,
      error_message:  null,
      created_at:     review.created_at,
    })
  })
)

// GET /api/grading/review/:id  — poll job status / fetch the finished review.
router.get(
  '/review/:id',
  asyncHandler(async (req, res) => {
    const review = await getLongReviewById(req.params.id, req.teacher.id)
    if (!review) return res.status(404).json({ error: 'Рецензия не найдена', code: 'NOT_FOUND' })
    res.json({
      id:             review.id,
      status:         review.status,
      progress_done:  review.progress_done,
      progress_total: review.progress_total,
      assignment_id:  review.assignment_id,
      result:         review.result,
      error_message:  review.error_message,
      created_at:     review.created_at,
    })
  })
)

// GET /api/grading/assignment/:id  — single assignment by id (teacher-scoped).
// Used by the frontend to pre-fill the form when starting a revision.
router.get(
  '/assignment/:id',
  asyncHandler(async (req, res) => {
    const assignment = await findAssignmentById(req.params.id, req.teacher.id)
    if (!assignment) return res.status(404).json({ error: 'Работа не найдена', code: 'NOT_FOUND' })
    res.json(assignment)
  })
)

// Approval history — the audit trail of every approve mutation on this row.
// Latest first. Returns [] when the row has never been approved, single
// element when it's been approved once (the common case).
router.get(
  '/assignment/:id/approval-history',
  asyncHandler(async (req, res) => {
    const history = await findApprovalHistory(req.params.id, req.teacher.id)
    res.json({ history })
  })
)

// Cross-teacher use count — how many times this teacher's grade has been
// pulled into a colleague's RAG retrieval within the institution. Returns
// {0, 0} for everything outside the institutional flywheel.
router.get(
  '/assignment/:id/cross-uses',
  asyncHandler(async (req, res) => {
    const assignment = await findAssignmentById(req.params.id, req.teacher.id)
    if (!assignment) return res.status(404).json({ error: 'Работа не найдена', code: 'NOT_FOUND' })
    res.json(await getCrossInstitutionUseCount(req.params.id))
  })
)

// GET /api/grading/assignment/:id/review  — the long review (if any) behind an assignment.
// Returns { review: null } rather than 404 so the client can quietly skip the chapter view.
router.get(
  '/assignment/:id/review',
  asyncHandler(async (req, res) => {
    const review = await getLongReviewByAssignmentId(req.params.id, req.teacher.id)
    res.json({
      review: review
        ? {
            id:             review.id,
            status:         review.status,
            progress_done:  review.progress_done,
            progress_total: review.progress_total,
            assignment_id:  review.assignment_id,
            result:         review.result,
            error_message:  review.error_message,
            created_at:     review.created_at,
          }
        : null,
    })
  })
)

// POST /api/grading/:id/approve
router.post(
  '/:id/approve',
  validate(approveRules),
  asyncHandler(async (req, res) => {
    const {
      approved_score, approved_grade, approved_feedback,
      approved_strengths, approved_improvements,
      approved_criteria_scores, approved_edit_reason,
    } = req.body as {
      approved_score:           number
      approved_grade:           GradeLetter
      approved_feedback:        string
      approved_strengths?:      BulletItem[]
      approved_improvements?:   BulletItem[]
      approved_criteria_scores?: import('../../../shared/types').CriterionScore[]
      approved_edit_reason?:    import('../../../shared/types').ApprovedEditReason
    }
    const assignment = await approve(req.params.id, req.teacher.id, {
      approvedScore:           Number(approved_score),
      approvedGrade:           approved_grade,
      approvedFeedback:        approved_feedback,
      approvedStrengths:       approved_strengths,
      approvedImprovements:    approved_improvements,
      approvedCriteriaScores:  approved_criteria_scores,
      approvedEditReason:      approved_edit_reason,
    })
    res.json({ assignment })
  })
)

// POST /api/grading/:id/email
router.post(
  '/:id/email',
  aiLimiter,
  checkFeatureAccess('emailGeneration'),
  asyncHandler(async (req, res) => {
    const tone = (req.body as { tone?: string }).tone as 'encouraging' | 'neutral' | 'direct' | undefined
    const draft = await generateEmailDraft(req.params.id, req.teacher.id, tone)
    res.json(draft)
  })
)

// POST /api/grading/:id/handout — compose a "доработка" packet from teacher-
// selected improvement bullets + verification questions. Light validation here;
// real argument validation happens in composeHandout (needs at least one of each).
router.post(
  '/:id/handout',
  aiLimiter,
  checkFeatureAccess('handout'),
  asyncHandler(async (req, res) => {
    const body = req.body as {
      improvements?: unknown
      questions?:    unknown
      tone?:         string
    }
    const improvements = Array.isArray(body.improvements)
      ? body.improvements.filter((x): x is string => typeof x === 'string').slice(0, 20)
      : []
    const questions = Array.isArray(body.questions)
      ? body.questions.filter((x): x is string => typeof x === 'string').slice(0, 20)
      : []
    const tone: 'encouraging' | 'neutral' | 'direct' =
      body.tone === 'encouraging' || body.tone === 'direct' ? body.tone : 'neutral'

    const draft = await composeHandout({
      assignmentId: req.params.id,
      teacherId:    req.teacher.id,
      improvements, questions, tone,
    })
    res.json(draft)
  })
)

// GET /api/grading/history  (optional student_name / student_group filters)
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const { course_id, student_name, student_group, search, status, page, limit } = req.query as Record<string, string>
    const result = await findAssignmentsByTeacher(req.teacher.id, {
      courseId:     course_id,
      studentName:  student_name,
      studentGroup: student_group,   // '' matches ungrouped (NULL)
      search:       search || undefined,
      status:       ['pending', 'approved', 'sent'].includes(status) ? status : undefined,
      page:         page  ? parseInt(page,  10) : undefined,
      limit:        limit ? parseInt(limit, 10) : undefined,
    })
    res.json(result)
  })
)

// GET /api/grading/library/search — search the teacher's own approved
// feedback library. Powers both the /library page and the inline hint that
// appears in the grading form while the AI is running.
router.get(
  '/library/search',
  asyncHandler(async (req, res) => {
    const q         = (req.query.q as string | undefined) ?? ''
    const courseId  = (req.query.course_id as string | undefined) || undefined
    const limitRaw  = parseInt((req.query.limit as string | undefined) ?? '', 10)
    const limit     = Number.isFinite(limitRaw) ? limitRaw : 10

    const hits = await searchFeedbackLibrary(req.teacher.id, {
      query:    q,
      courseId,
      limit,
    })
    res.json({ hits })
  })
)

// GET /api/grading/export  — CSV of grades (Moodle-compatible: matches users by email)
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const courseId = req.query.course_id as string | undefined
    const rows = await findAssignmentsForExport(req.teacher.id, courseId)
    const csv = toCsv(
      ['Email address', 'Полное имя', 'Группа', 'Балл', 'Оценка', 'Статус', 'Дата', 'Отзыв'],
      rows.map((r) => [
        r.student_email ?? '',
        r.student_name ?? '',
        r.student_group ?? '',
        r.approved_score ?? r.ai_score ?? '',
        r.approved_grade ?? r.ai_grade ?? '',
        r.status,
        new Date(r.created_at).toISOString().slice(0, 10),
        (r.approved_feedback ?? r.ai_feedback ?? '').replace(/\s+/g, ' ').trim(),
      ])
    )
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('ispum_grades')}"`)
    res.send(csv)
  })
)

// GET /api/grading/students  — aggregated roster (denormalized from assignments)
router.get(
  '/students',
  asyncHandler(async (req, res) => {
    const courseId = req.query.course_id as string | undefined
    res.json(await findStudentsByTeacher(req.teacher.id, courseId))
  })
)

// GET /api/grading/stats
router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const { rows } = await pool.query<{
      total: string; pending: string
      this_month: string; last_month: string; avg_score: string | null
    }>(
      `SELECT
        COUNT(*)                                                          AS total,
        COUNT(*) FILTER (WHERE status = 'pending')                       AS pending,
        COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW())) AS this_month,
        COUNT(*) FILTER (
          WHERE created_at >= date_trunc('month', NOW() - INTERVAL '1 month')
            AND created_at <  date_trunc('month', NOW())
        )                                                                 AS last_month,
        ROUND(AVG(approved_score) FILTER (WHERE approved_score IS NOT NULL))::text AS avg_score
      FROM assignments WHERE teacher_id = $1`,
      [req.teacher.id]
    )
    const r = rows[0]
    res.json({
      total:      parseInt(r.total,      10),
      pending:    parseInt(r.pending,    10),
      this_month: parseInt(r.this_month, 10),
      last_month: parseInt(r.last_month, 10),
      avg_score:  r.avg_score ? parseInt(r.avg_score, 10) : null,
    })
  })
)

export default router
