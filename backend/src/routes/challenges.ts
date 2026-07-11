import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { checkFeatureAccess } from '../middleware/checkPlan'
import { aiLimiter } from '../middleware/rateLimits'
import { validate } from '../middleware/validate'
import { challengeRules } from '../validation/challengeValidation'
import { challengeFeedback } from '../services/feedbackChallenge'
import { insertFeedbackChallenge } from '../db/queries/feedbackChallenges'
import { findAssignmentById } from '../db/queries/assignments'
import { NotFoundError } from '../errors/AppError'
import type { ChallengeRequest } from '../../../shared/types'

const router = Router()
router.use(authenticate)

// POST /api/challenges — "Оспорить": re-verify a piece of AI feedback the
// teacher believes is wrong, grounded in a fresh citation against the same
// source text (see services/feedbackChallenge.ts).
router.post(
  '/',
  aiLimiter,
  checkFeatureAccess('challengeFeedback'),
  validate(challengeRules),
  asyncHandler(async (req, res) => {
    const body = req.body as ChallengeRequest

    if (body.assignment_id) {
      const assignment = await findAssignmentById(body.assignment_id, req.teacher.id)
      if (!assignment) throw new NotFoundError('Работа')
    }

    const result = await challengeFeedback({
      ...body,
      teacherId:     req.teacher.id,
      institutionId: req.teacher.institution_id ?? undefined,
    })

    await insertFeedbackChallenge({
      teacherId:     req.teacher.id,
      assignmentId:  body.assignment_id ?? null,
      sourceType:    body.source_type,
      itemRef:       body.item_ref ?? null,
      claimText:     body.claim_text,
      claimQuote:    body.claim_quote ?? null,
      objection:     body.objection,
      verdict:       result.verdict,
      explanation:   result.explanation,
      evidenceQuote: result.evidence_quote,
      suggestedText: result.suggested_text,
    })

    res.json(result)
  })
)

export default router
