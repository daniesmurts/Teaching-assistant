import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { aiLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { checkMonthlyLimit, checkFeatureAccess } from '../middleware/checkPlan'
import { grade, approve } from '../services/grading'
import { generateEmailDraft } from '../services/email'
import { findAssignmentsByTeacher } from '../db/queries/assignments'
import { pool } from '../db/connection'
import type { GradeLetter } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// POST /api/grading/grade
router.post(
  '/grade',
  aiLimiter,
  checkMonthlyLimit('gradesPerMonth'),
  validate([{ field: 'submission_text', type: 'string', required: true, minLength: 10 }]),
  asyncHandler(async (req, res) => {
    const { submission_text, rubric_id, course_id, student_name, student_email } = req.body as {
      submission_text: string
      rubric_id?: string
      course_id?: string
      student_name?: string
      student_email?: string
    }
    const result = await grade({
      teacherId:      req.teacher.id,
      planTier:       req.teacher.plan_tier,
      submissionText: submission_text,
      rubricId:       rubric_id,
      courseId:       course_id,
      studentName:    student_name,
      studentEmail:   student_email,
    })
    res.json(result)
  })
)

// POST /api/grading/:id/approve
router.post(
  '/:id/approve',
  validate([
    { field: 'approved_score',    required: true },
    { field: 'approved_grade',    type: 'string', required: true },
    { field: 'approved_feedback', type: 'string', required: true },
  ]),
  asyncHandler(async (req, res) => {
    const { approved_score, approved_grade, approved_feedback } = req.body as {
      approved_score: number
      approved_grade: GradeLetter
      approved_feedback: string
    }
    const assignment = await approve(req.params.id, req.teacher.id, {
      approvedScore:    Number(approved_score),
      approvedGrade:    approved_grade,
      approvedFeedback: approved_feedback,
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

// GET /api/grading/history
router.get(
  '/history',
  asyncHandler(async (req, res) => {
    const { course_id, page, limit } = req.query as Record<string, string>
    const result = await findAssignmentsByTeacher(req.teacher.id, {
      courseId: course_id,
      page:     page  ? parseInt(page,  10) : undefined,
      limit:    limit ? parseInt(limit, 10) : undefined,
    })
    res.json(result)
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
