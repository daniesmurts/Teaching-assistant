import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { grade, approve } from '../services/grading'
import { generateEmailDraft } from '../services/email'
import { findAssignmentsByTeacher } from '../db/queries/assignments'
import type { GradeLetter } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// POST /api/grading/grade
router.post(
  '/grade',
  validate([{ field: 'submission_text', type: 'string', required: true, minLength: 10 }]),
  async (req, res, next) => {
    try {
      const { submission_text, rubric_id, course_id, student_name, student_email } = req.body as {
        submission_text: string
        rubric_id?: string
        course_id?: string
        student_name?: string
        student_email?: string
      }
      const result = await grade({
        teacherId: req.teacher.id,
        submissionText: submission_text,
        rubricId: rubric_id,
        courseId: course_id,
        studentName: student_name,
        studentEmail: student_email,
      })
      res.json(result)
    } catch (err) { next(err) }
  }
)

// POST /api/grading/:id/approve
router.post(
  '/:id/approve',
  validate([
    { field: 'approved_score', required: true },
    { field: 'approved_grade', type: 'string', required: true },
    { field: 'approved_feedback', type: 'string', required: true },
  ]),
  async (req, res, next) => {
    try {
      const { approved_score, approved_grade, approved_feedback } = req.body as {
        approved_score: number
        approved_grade: GradeLetter
        approved_feedback: string
      }
      const assignment = await approve(req.params.id, req.teacher.id, {
        approvedScore: Number(approved_score),
        approvedGrade: approved_grade,
        approvedFeedback: approved_feedback,
      })
      res.json({ assignment })
    } catch (err) { next(err) }
  }
)

// POST /api/grading/:id/email
router.post('/:id/email', async (req, res, next) => {
  try {
    const tone = (req.body as { tone?: string }).tone as 'encouraging' | 'neutral' | 'direct' | undefined
    const draft = await generateEmailDraft(req.params.id, req.teacher.id, tone)
    res.json(draft)
  } catch (err) { next(err) }
})

// GET /api/grading/history
router.get('/history', async (req, res, next) => {
  try {
    const { course_id, page, limit } = req.query as Record<string, string>
    const result = await findAssignmentsByTeacher(req.teacher.id, {
      courseId: course_id,
      page: page ? parseInt(page) : undefined,
      limit: limit ? parseInt(limit) : undefined,
    })
    res.json(result)
  } catch (err) { next(err) }
})

export default router
