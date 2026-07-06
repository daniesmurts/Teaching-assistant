import { Router } from 'express'
import { validate } from '../middleware/validate'
import { publicFormLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { contactMessageRules } from '../validation/contactValidation'
import { createContactMessage } from '../db/queries/contactMessages'
import { sendEmail, adminNotifyTo } from '../services/emailTransport'
import { contactMessageEmail } from '../lib/emailTemplates'

const router = Router()

// POST /api/contact — public, unauthenticated (marketing-site Contact + Research
// forms). Stored first (source of truth, visible in the admin inbox even if the
// notification email fails), then the owner is notified best-effort.
router.post(
  '/',
  publicFormLimiter,
  validate(contactMessageRules),
  asyncHandler(async (req, res) => {
    const { name, email, organization, topic, message, sourcePage } = req.body as {
      name: string; email: string; organization?: string; topic?: string; message: string; sourcePage: string
    }

    await createContactMessage({
      name,
      email,
      organization: organization || null,
      topic: topic ?? 'support',
      message,
      sourcePage,
    })

    const adminTo = adminNotifyTo()
    if (adminTo) {
      sendEmail({
        ...contactMessageEmail({ name, email, organization, topic: topic ?? 'support', message, sourcePage }),
        to: adminTo,
      }).catch(() => null)
    }

    res.status(201).json({ ok: true })
  })
)

export default router
