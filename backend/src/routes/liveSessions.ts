import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { liveLimiter } from '../middleware/rateLimits'
import { checkLiveSessionMonthlyLimit } from '../middleware/checkPlan'
import { asyncHandler } from '../lib/asyncHandler'
import { createLiveSessionRules, liveSessionIdRules, saveToJournalRules } from '../validation/liveSessionValidation'
import { findQuizById } from '../db/queries/quizzes'
import { createAssignment } from '../db/queries/assignments'
import { approve } from '../services/grading'
import type { QuizQuestion } from '../../../shared/types'
import {
  createLiveSession, getLiveSessionById, getParticipantCount, getAnswerCounts, setLiveSessionState, finishLiveSession,
  getSessionParticipants, closeLiveSession, getParticipantById, linkParticipantAssignment, getParticipantAnswers,
} from '../db/queries/liveSessions'
import { nextStatus, scoreParticipant, scoreToGrade } from '../services/liveSessions'
import { NotFoundError, ValidationError } from '../errors/AppError'
import type { LiveQuestionResult, LiveSession, LiveSessionParticipantProgress } from '../../../shared/types'

// Teacher-side, authenticated — creates and controls a live quiz session.
// Mounted at /api/live-sessions. Public join/answer routes live in a
// separate router (routes/liveJoin.ts), same two-file split as
// publishedAssignments.ts / publicWrite.ts.

const router = Router()
router.use(authenticate)
router.use(liveLimiter)

// "Who got what points" — computed for BOTH modes, not just self-paced: the
// paced-mode finished screen previously only had a per-question aggregate
// (73% got Q3 right) with no way to see any individual student's score.
// Scoring needs the quiz's own correct_index, so this always fetches the
// quiz alongside the roster now (previously only /next and /finish did).
async function loadSessionView(sessionId: string, teacherId: string): Promise<LiveSession> {
  const session = await getLiveSessionById(sessionId, teacherId)
  if (!session) throw new NotFoundError('Сессия')

  const isSelfPaced = session.mode === 'self_paced'
  const [participant_count, answer_counts, quiz, rawParticipants] = await Promise.all([
    getParticipantCount(session.id),
    (!isSelfPaced && (session.status === 'question' || session.status === 'reveal'))
      ? getAnswerCounts(session.id, session.current_question_index)
      : Promise.resolve(null),
    findQuizById(session.quiz_id, teacherId),
    getSessionParticipants(session.id),
  ])

  const participants: LiveSessionParticipantProgress[] = rawParticipants.map((p) => ({
    id: p.id,
    nickname: p.nickname,
    current_question_index: p.current_question_index,
    finished_at: p.finished_at,
    already_saved: p.already_saved,
    score: quiz ? scoreParticipant(quiz.questions, p.answers) : { correct: 0, total: 0 },
  }))

  return {
    id: session.id, teacher_id: session.teacher_id, quiz_id: session.quiz_id,
    join_code: session.join_code, mode: session.mode, status: session.status,
    current_question_index: session.current_question_index,
    participant_count, answer_counts, participants,
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

    const session = await createLiveSession({ teacherId: req.teacher.id, quizId: quiz.id, mode: req.body.mode })
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
// Shared for the ONE lobby -> question kickoff ("Начать") regardless of
// mode — after that, self-paced has no shared "next question" to advance
// (each participant drives their own via /api/live-join/:code/advance), so
// any further call is blocked once the session has left the lobby.
router.post(
  '/:id/next',
  validate(liveSessionIdRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionById(req.params.id, req.teacher.id)
    if (!session) throw new NotFoundError('Сессия')
    if (session.mode === 'self_paced' && session.status !== 'lobby') {
      throw new ValidationError('У сессии «в своём темпе» нет общего следующего вопроса — участники продвигаются самостоятельно.')
    }
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

// POST /api/live-sessions/:id/finish — paced: force-finish early (aggregates
// results same as reaching the end naturally). Self-paced: only stops the
// session accepting NEW joins — never touches an in-progress participant's
// own attempt (their own finished_at ends it, independent of this).
router.post(
  '/:id/finish',
  validate(liveSessionIdRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionById(req.params.id, req.teacher.id)
    if (!session) throw new NotFoundError('Сессия')
    if (session.status === 'finished') { res.json(await loadSessionView(session.id, req.teacher.id)); return }

    if (session.mode === 'self_paced') {
      await closeLiveSession(session.id)
      res.json(await loadSessionView(session.id, req.teacher.id))
      return
    }

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

// POST /api/live-sessions/:id/save-to-journal — teacher-reviewed write into
// the main grading journal (the `assignments` table), so a live-quiz score
// can count toward a student's semester grade like any other graded work.
// Only participants the teacher explicitly included (and named — a
// live-quiz participant has only a free-text nickname, not a real student
// identity) are written; each becomes a real journal entry via the same
// create -> approve pipeline every other grade goes through (not a raw
// already-approved insert — see services/liveSessions.ts's header comment
// for why that consistency matters), so it gets the same RAG-embedding/
// policy-memo/LTI-sync side effects as any other approval.
router.post(
  '/:id/save-to-journal',
  validate(saveToJournalRules),
  asyncHandler(async (req, res) => {
    const session = await getLiveSessionById(req.params.id, req.teacher.id)
    if (!session) throw new NotFoundError('Сессия')

    const quiz = await findQuizById(session.quiz_id, req.teacher.id)
    if (!quiz) throw new NotFoundError('Тест')

    const courseId: string | undefined = req.body.course_id ?? quiz.course_id ?? undefined
    const checkpointId: string | undefined = req.body.checkpoint_id ?? undefined
    const entries = req.body.entries as { participant_id: string; student_name: string; student_group?: string }[]

    let created = 0
    let skipped = 0

    for (const entry of entries) {
      const participant = await getParticipantById(entry.participant_id, session.id)
      if (!participant) { skipped++; continue }
      if (participant.assignment_id) { skipped++; continue }   // idempotent — already saved on a previous call

      const answers = await getParticipantAnswers(participant.id)
      const { correct, total } = scoreParticipant(quiz.questions, answers)
      const pct = total > 0 ? Math.round((correct / total) * 100) : 0
      const { grade, label } = scoreToGrade(correct, total)
      const submissionText = `Живой тест «${quiz.topic}» — ${correct} из ${total} правильных ответов (${pct}%).`

      const assignment = await createAssignment({
        teacherId: req.teacher.id, courseId,
        studentName: entry.student_name, studentGroup: entry.student_group,
        submissionText, aiScore: pct, aiGrade: grade, aiGradeLabel: label, aiFeedback: submissionText,
        aiCriteriaScores: [], aiStrengths: [], aiImprovements: [],
      })
      await approve(assignment.id, req.teacher.id, {
        approvedScore: pct, approvedGrade: grade, approvedFeedback: submissionText,
        approvedBrsCheckpointId: checkpointId ?? null,
      })
      await linkParticipantAssignment(participant.id, assignment.id)
      created++
    }

    res.json({ created, skipped })
  })
)

export default router
