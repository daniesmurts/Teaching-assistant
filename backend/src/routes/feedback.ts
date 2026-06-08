import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { generalLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { feedbackRules } from '../validation/feedbackValidation'
import { createFeedback } from '../db/queries/feedback'
import { findTeacherById } from '../db/queries/teachers'
import { sendEmail, adminNotifyTo } from '../services/emailTransport'
import { feedbackEmail } from '../lib/emailTemplates'

const router = Router()
router.use(authenticate)

// POST /api/feedback  — store the feedback (source of truth) + notify the owner.
router.post(
  '/',
  generalLimiter,
  validate(feedbackRules),
  asyncHandler(async (req, res) => {
    const { message, category, page } = req.body as { message: string; category?: string; page?: string }

    await createFeedback({
      teacherId: req.teacher.id,
      category:  category ?? 'other',
      message,
      page,
    })

    // Owner notification — fire-and-forget, never blocks the response
    const adminTo = adminNotifyTo()
    if (adminTo) {
      findTeacherById(req.teacher.id)
        .then((t) => sendEmail({
          ...feedbackEmail({
            name:     t?.name,
            email:    req.teacher.email,
            plan:     req.teacher.plan_tier,
            category: category ?? 'other',
            message,
            page,
          }),
          to: adminTo,
        }))
        .catch(() => null)
    }

    res.status(201).json({ ok: true })
  })
)

export default router
