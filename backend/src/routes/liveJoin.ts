import { Router } from 'express'
import { validate } from '../middleware/validate'
import { liveLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { joinSessionRules, joinCodeRules, answerRules, advanceRules } from '../validation/liveSessionValidation'
import { findQuizById } from '../db/queries/quizzes'
import {
  getLiveSessionByCode, addParticipant, getParticipantByToken, getParticipantAnswers, recordAnswer,
  advanceParticipant, finishParticipant,
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
    if (session.status === 'finished') throw new ValidationError('Эта сессия уже завершена — новые участники не принимаются.')

    const participant = await addParticipant(session.id, req.body.nickname)
    res.status(201).json({ participant_token: participant.participant_token, session_id: session.id })
  })
)

// GET /api/live-join/:code/state — polled by the student's phone every ~2s.
// Never leaks correct_index before it's revealed. Branches on session.mode:
// 'paced' uses the session-wide question/status (unchanged from before this
// mode existed); 'self_paced' derives status/question purely from this
// participant's own current_question_index and answers — there is no shared
// "current question" to wait on.
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
    const answers = await getParticipantAnswers(participant.id)

    const isSelfPaced = session.mode === 'self_paced'
    const questionIndex = isSelfPaced ? participant.current_question_index : session.current_question_index

    // Effective status: 'paced' just mirrors the session; 'self_paced' is
    // derived per-participant — finished once they've answered their last
    // question, 'reveal' once they've answered the current one (immediate
    // personal feedback, no waiting on the teacher), else 'question'.
    const status = isSelfPaced
      ? (session.status === 'lobby'
          ? 'lobby'
          : participant.finished_at
            ? 'finished'
            : (answers[questionIndex] !== undefined ? 'reveal' : 'question'))
      : session.status

    const question = quiz?.questions[questionIndex] ?? null
    const isLive = status === 'question' || status === 'reveal'
    const my_choice = isLive ? (answers[questionIndex] ?? null) : null

    let participant_score: LiveJoinState['participant_score'] = null
    if (status === 'finished' && quiz) {
      let correct = 0
      quiz.questions.forEach((q, i) => { if (answers[i] === q.correct_index) correct++ })
      participant_score = { correct, total: quiz.questions.length }
    }

    const state: LiveJoinState = {
      mode: session.mode,
      status,
      current_question_index: questionIndex,
      question: (question && isLive)
        ? {
            question: question.question,
            options: question.options,
            // Only once revealed — same "never leak before reveal" rule as correct_index.
            explanation: status === 'reveal' ? question.explanation : undefined,
          }
        : null,
      has_answered: my_choice !== null,
      my_choice,
      correct_index: status === 'reveal' ? (question?.correct_index ?? null) : null,
      participant_score,
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

    const isSelfPaced = session.mode === 'self_paced'
    // 'paced' — the whole room must be on the shared "question" step.
    // 'self_paced' — there's no shared gate to check; the participant's own
    // current_question_index (validated below by the unique-answer
    // constraint) is the only thing that matters, as long as they haven't
    // already finished.
    if (!isSelfPaced && session.status !== 'question') {
      res.status(409).json({ error: 'Сейчас не время отвечать на вопрос.', code: 'NOT_ACCEPTING_ANSWERS' })
      return
    }
    if (isSelfPaced && participant.finished_at) {
      res.status(409).json({ error: 'Вы уже завершили тест.', code: 'ALREADY_FINISHED' })
      return
    }

    const questionIndex = isSelfPaced ? participant.current_question_index : session.current_question_index
    const { recorded } = await recordAnswer(participant.id, session.id, questionIndex, req.body.choice_index)
    if (!recorded) {
      res.status(409).json({ error: 'Вы уже ответили на этот вопрос.', code: 'ALREADY_ANSWERED' })
      return
    }

    res.status(201).json({ ok: true })
  })
)

// POST /api/live-join/:code/advance — self-paced only. Moves the
// participant on to the next question (or marks them finished if that was
// the last one) once they've seen their own reveal/explanation for the
// current one. No-op guard against a paced session — that mode has no
// per-participant pointer to advance.
router.post(
  '/:code/advance',
  validate(advanceRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionByCode(req.params.code)
    if (!session) throw new NotFoundError('Сессия')
    if (session.mode !== 'self_paced') throw new ValidationError('Эта сессия не в режиме «в своём темпе».')

    const participant = await getParticipantByToken(session.id, req.body.participant_token)
    if (!participant) throw new NotFoundError('Участник')
    if (participant.finished_at) { res.json({ ok: true }); return }

    const quiz = await findQuizById(session.quiz_id, session.teacher_id)
    if (!quiz) throw new NotFoundError('Тест')

    const next = participant.current_question_index + 1
    if (next >= quiz.questions.length) {
      await finishParticipant(participant.id)
    } else {
      await advanceParticipant(participant.id, next)
    }
    res.json({ ok: true })
  })
)

export default router
