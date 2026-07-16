import { Router } from 'express'
import { validate } from '../middleware/validate'
import { liveLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError } from '../errors/AppError'
import { joinSessionRules, joinCodeRules, answerRules } from '../validation/liveSessionValidation'
import { findQuizById } from '../db/queries/quizzes'
import {
  getLiveSessionByCode, addParticipant, getParticipantByToken, hasAnswered, recordAnswer,
} from '../db/queries/liveSessions'
import type { LiveJoinState } from '../../../shared/types'

// Public student join/answer surface (TODO.md Feature Y). NO teacher JWT —
// the server-issued participant_token IS the credential, same posture as
// publicWrite.ts's student-writing surface. Mounted at /api/live-join.

const router = Router()
router.use(liveLimiter)

// POST /api/live-join/:code/join — anonymous join, issues a participant token.
router.post(
  '/:code/join',
  validate(joinSessionRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionByCode(req.params.code)
    if (!session) throw new NotFoundError('Сессия')

    const participant = await addParticipant(session.id, req.body.nickname)
    res.status(201).json({ participant_token: participant.participant_token, session_id: session.id })
  })
)

// GET /api/live-join/:code/state — polled by the student's phone every ~2s.
// Never leaks correct_index before the teacher reveals it.
router.get(
  '/:code/state',
  validate(joinCodeRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionByCode(req.params.code)
    if (!session) throw new NotFoundError('Сессия')

    const token = req.query.participant_token as string | undefined
    const participant = token ? await getParticipantByToken(session.id, token) : null
    if (!participant) throw new NotFoundError('Участник')

    const quiz = await findQuizById(session.quiz_id, session.teacher_id)
    const question = quiz?.questions[session.current_question_index] ?? null

    const has_answered = (session.status === 'question' || session.status === 'reveal')
      ? await hasAnswered(participant.id, session.current_question_index)
      : false

    const state: LiveJoinState = {
      status: session.status,
      current_question_index: session.current_question_index,
      question: (question && (session.status === 'question' || session.status === 'reveal'))
        ? { question: question.question, options: question.options }
        : null,
      has_answered,
      correct_index: session.status === 'reveal' ? (question?.correct_index ?? null) : null,
    }
    res.json(state)
  })
)

// POST /api/live-join/:code/answer — answer-once, enforced by a DB constraint.
router.post(
  '/:code/answer',
  validate(answerRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionByCode(req.params.code)
    if (!session) throw new NotFoundError('Сессия')

    const participant = await getParticipantByToken(session.id, req.body.participant_token)
    if (!participant) throw new NotFoundError('Участник')

    if (session.status !== 'question') {
      res.status(409).json({ error: 'Сейчас не время отвечать на вопрос.', code: 'NOT_ACCEPTING_ANSWERS' })
      return
    }

    const { recorded } = await recordAnswer(participant.id, session.id, session.current_question_index, req.body.choice_index)
    if (!recorded) {
      res.status(409).json({ error: 'Вы уже ответили на этот вопрос.', code: 'ALREADY_ANSWERED' })
      return
    }

    res.status(201).json({ ok: true })
  })
)

export default router
