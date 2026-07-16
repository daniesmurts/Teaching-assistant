import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { liveLimiter } from '../middleware/rateLimits'
import { checkLiveSessionMonthlyLimit } from '../middleware/checkPlan'
import { asyncHandler } from '../lib/asyncHandler'
import { createLiveSessionRules, liveSessionIdRules } from '../validation/liveSessionValidation'
import { findQuizById } from '../db/queries/quizzes'
import type { QuizQuestion } from '../../../shared/types'
import {
  createLiveSession, getLiveSessionById, getParticipantCount, getAnswerCounts, setLiveSessionState, finishLiveSession,
} from '../db/queries/liveSessions'
import { nextStatus } from '../services/liveSessions'
import { NotFoundError, ValidationError } from '../errors/AppError'
import type { LiveQuestionResult, LiveSession } from '../../../shared/types'

// Teacher-side, authenticated — creates and controls a live quiz session.
// Mounted at /api/live-sessions. Public join/answer routes live in a
// separate router (routes/liveJoin.ts), same two-file split as
// publishedAssignments.ts / publicWrite.ts.

const router = Router()
router.use(authenticate)
router.use(liveLimiter)

async function loadSessionView(sessionId: string, teacherId: string): Promise<LiveSession> {
  const session = await getLiveSessionById(sessionId, teacherId)
  if (!session) throw new NotFoundError('Сессия')

  const [participant_count, answer_counts] = await Promise.all([
    getParticipantCount(session.id),
    session.status === 'question' || session.status === 'reveal'
      ? getAnswerCounts(session.id, session.current_question_index)
      : Promise.resolve(null),
  ])

  return {
    id: session.id, teacher_id: session.teacher_id, quiz_id: session.quiz_id,
    join_code: session.join_code, status: session.status,
    current_question_index: session.current_question_index,
    participant_count, answer_counts,
    results: session.results, created_at: session.created_at, finished_at: session.finished_at,
  }
}

// POST /api/live-sessions — create a session (lobby) from an existing quiz.
router.post(
  '/',
  checkLiveSessionMonthlyLimit(),
  validate(createLiveSessionRules),
  asyncHandler(async (req, res) => {
    const quiz = await findQuizById(req.body.quiz_id, req.teacher.id)
    if (!quiz) throw new NotFoundError('Тест')
    if (quiz.questions.length === 0) throw new ValidationError('В этом тесте нет вопросов.')

    const session = await createLiveSession({ teacherId: req.teacher.id, quizId: quiz.id })
    res.status(201).json(await loadSessionView(session.id, req.teacher.id))
  })
)

// GET /api/live-sessions/:id — host poll: session + live participant count + current-question answer counts.
router.get(
  '/:id',
  validate(liveSessionIdRules),
  asyncHandler(async (req, res) => {
    res.json(await loadSessionView(req.params.id, req.teacher.id))
  })
)

// POST /api/live-sessions/:id/next — advance the state machine one step.
router.post(
  '/:id/next',
  validate(liveSessionIdRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionById(req.params.id, req.teacher.id)
    if (!session) throw new NotFoundError('Сессия')
    if (session.status === 'finished') throw new ValidationError('Сессия уже завершена.')

    const quiz = await findQuizById(session.quiz_id, req.teacher.id)
    if (!quiz) throw new NotFoundError('Тест')

    const next = nextStatus(session, quiz.questions.length)

    if (next.status === 'finished') {
      await writeResults(session.id, quiz.questions)
    } else {
      await setLiveSessionState(session.id, next.status, next.current_question_index)
    }

    res.json(await loadSessionView(session.id, req.teacher.id))
  })
)

// POST /api/live-sessions/:id/finish — force-finish early.
router.post(
  '/:id/finish',
  validate(liveSessionIdRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionById(req.params.id, req.teacher.id)
    if (!session) throw new NotFoundError('Сессия')
    if (session.status === 'finished') { res.json(await loadSessionView(session.id, req.teacher.id)); return }

    const quiz = await findQuizById(session.quiz_id, req.teacher.id)
    if (!quiz) throw new NotFoundError('Тест')

    await writeResults(session.id, quiz.questions)
    res.json(await loadSessionView(session.id, req.teacher.id))
  })
)

// Aggregates every question's answer counts into `results` before marking
// the session finished — raw live_answers rows are left in place (pruning
// them is a documented later cleanup, not needed for v1).
async function writeResults(sessionId: string, questions: QuizQuestion[]): Promise<void> {
  const results: LiveQuestionResult[] = []
  for (let i = 0; i < questions.length; i++) {
    const answer_counts = await getAnswerCounts(sessionId, i)
    results.push({ question_index: i, answer_counts, correct_index: questions[i].correct_index })
  }
  await finishLiveSession(sessionId, results)
}

export default router
