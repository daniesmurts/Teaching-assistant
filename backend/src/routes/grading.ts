import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { gradeRules, approveRules, reviewRules } from '../validation/gradingValidation'
import { asyncHandler } from '../lib/asyncHandler'
import { checkMonthlyLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { grade, approve } from '../services/grading'
import { runLongReview } from '../services/longReview'
import { createLongReview, getLongReviewById, getLongReviewByAssignmentId } from '../db/queries/longReviews'
import { generateEmailDraft } from '../services/email'
import { findAssignmentsByTeacher, findStudentsByTeacher, findAssignmentsForExport, findAssignmentById } from '../db/queries/assignments'
import { toCsv, csvFilename } from '../lib/csv'
import { pool } from '../db/connection'
import type { GradeLetter } from '../../../shared/types'

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
      reference_solution, assignment_type, parent_assignment_id,
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
    }
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
    } = req.body as {
      approved_score: number
      approved_grade: GradeLetter
      approved_feedback: string
      approved_strengths?: string[]
      approved_improvements?: string[]
    }
    const assignment = await approve(req.params.id, req.teacher.id, {
      approvedScore:        Number(approved_score),
      approvedGrade:        approved_grade,
      approvedFeedback:     approved_feedback,
      approvedStrengths:    approved_strengths,
      approvedImprovements: approved_improvements,
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
