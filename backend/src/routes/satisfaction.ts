import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { generalLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { logger } from '../lib/logger'
import {
  satisfactionCheckRules, satisfactionAnswerRules, satisfactionCommentRules,
} from '../validation/satisfactionValidation'
import { createPrompt, recordResponse, attachComment, recordDismissal } from '../db/queries/satisfaction'
import { shouldPrompt, type SatisfactionFeature } from '../services/satisfaction'
import { findTeacherById } from '../db/queries/teachers'

const router = Router()
router.use(authenticate)

// POST /api/satisfaction/check — "should I ask this teacher right now?"
//
// A POST rather than a GET despite reading like a query: when the answer is
// yes it CREATES the prompt row, which is what advances the throttle. Booking
// the prompt at display time rather than at answer time is the whole reason a
// teacher who dismisses isn't asked again tomorrow.
router.post(
  '/check',
  generalLimiter,
  validate(satisfactionCheckRules),
  asyncHandler(async (req, res) => {
    const { feature, artifactId, context } = req.body as {
      feature: SatisfactionFeature
      artifactId?: string | null
      context?: Record<string, unknown>
    }

    const teacher = await findTeacherById(req.teacher.id)
    if (!teacher) throw new NotFoundError('Преподаватель')

    const reason = await shouldPrompt({
      teacherId:        req.teacher.id,
      feature,
      accountCreatedAt: teacher.created_at,
      isPlatformAdmin:  req.teacher.is_platform_admin,
    })
    if (reason) return res.json({ prompt: false, reason })

    const prompt = await createPrompt({
      teacherId:     req.teacher.id,
      institutionId: req.teacher.institution_id,
      feature,
      artifactId,
      context,
    })
    res.json({ prompt: true, promptId: prompt.id })
  })
)

// POST /api/satisfaction/:id/answer — 1/2/3, optional comment in the same call.
router.post(
  '/:id/answer',
  generalLimiter,
  validate(satisfactionAnswerRules),
  asyncHandler(async (req, res) => {
    const { score, comment } = req.body as { score: number; comment?: string | null }
    const updated = await recordResponse(req.params.id, req.teacher.id, score, comment)
    if (!updated) throw new NotFoundError('Оценка')
    res.json({ ok: true })
  })
)

// POST /api/satisfaction/:id/comment — the «Расскажите подробнее» follow-up,
// sent after the score so a teacher who only wants to tap a button is done in
// one tap. A bare low score is nearly unactionable at this volume (the same
// lesson ArticleFeedback already encodes for its thumbs-down), so this is
// offered on every score, not just the bad ones — «хорошо» plus a sentence
// about why is the rarest and most useful row in the table.
router.post(
  '/:id/comment',
  generalLimiter,
  validate(satisfactionCommentRules),
  asyncHandler(async (req, res) => {
    const updated = await attachComment(req.params.id, req.teacher.id, (req.body as { comment: string }).comment)
    if (!updated) throw new NotFoundError('Оценка')
    res.json({ ok: true })
  })
)

// POST /api/satisfaction/:id/dismiss — the × .
//
// Recorded rather than ignored: shown-minus-answered is the dismissal rate,
// and the dismissal rate is the kill switch for this whole mechanism (see the
// Phase 2 gate in TODO). Never fails the request — a dismissal that errors
// must not put an error toast in front of someone who just asked to be left
// alone.
router.post('/:id/dismiss', generalLimiter, asyncHandler(async (req, res) => {
  await recordDismissal(req.params.id, req.teacher.id)
    .catch((e) => logger.warn({ message: 'Failed to record satisfaction dismissal', error: (e as Error).message }))
  res.json({ ok: true })
}))

export default router
