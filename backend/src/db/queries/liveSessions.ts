import { randomBytes, randomUUID } from 'node:crypto'
import { pool } from '../connection'
import type { LiveSessionStatus, LiveSessionMode, LiveQuestionResult } from '../../../../shared/types'

export interface LiveSessionRow {
  id:                      string
  teacher_id:              string
  quiz_id:                 string
  join_code:               string
  mode:                    LiveSessionMode
  status:                  LiveSessionStatus
  current_question_index: number
  results:                 LiveQuestionResult[] | null
  created_at:              string
  finished_at:             string | null
}

export interface LiveParticipantRow {
  id:                      string
  session_id:              string
  participant_token:       string
  nickname:                string | null
  current_question_index: number
  finished_at:             string | null
  assignment_id:           string | null
  joined_at:               string
}

// 6-char human-typeable code — ambiguous characters (0/O, 1/I/L) excluded so
// it reads unambiguously off a projector. Not the 48-hex-char opaque token
// pattern used for published-assignment invites (generateInviteToken) —
// that shape is unusable projected on a screen.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 6
const MAX_CODE_ATTEMPTS = 10

function generateJoinCode(): string {
  let code = ''
  const bytes = randomBytes(CODE_LENGTH)
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return code
}

export async function createLiveSession(
  data: { teacherId: string; quizId: string; mode?: LiveSessionMode }
): Promise<LiveSessionRow> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateJoinCode()
    try {
      const { rows } = await pool.query<LiveSessionRow>(
        `INSERT INTO live_sessions (teacher_id, quiz_id, join_code, mode) VALUES ($1, $2, $3, $4) RETURNING *`,
        [data.teacherId, data.quizId, code, data.mode ?? 'paced']
      )
      return rows[0]
    } catch (err) {
      // Unique-violation on join_code — vanishingly rare with a 32^6 space,
      // but retry rather than fail a teacher's session launch outright.
      if ((err as { code?: string }).code === '23505') continue
      throw err
    }
  }
  throw new Error('Не удалось сгенерировать уникальный код сессии — попробуйте ещё раз')
}

export async function getLiveSessionById(id: string, teacherId: string): Promise<LiveSessionRow | null> {
  const { rows } = await pool.query<LiveSessionRow>(
    `SELECT * FROM live_sessions WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  return rows[0] ?? null
}

// Any status, including finished — used by /state polling (which must keep
// working after the teacher finishes, so a student can see their final
// score) and /answer. Was previously status != 'finished', which broke
// exactly that: once the session finished, the student's poll started
// 404ing and they saw a bare "Сессия недоступна" error instead of results.
// Joinability (a finished session shouldn't accept NEW participants) is
// enforced separately, only in the /join route.
export async function getLiveSessionByCode(code: string): Promise<LiveSessionRow | null> {
  const { rows } = await pool.query<LiveSessionRow>(
    `SELECT * FROM live_sessions WHERE join_code = $1`,
    [code.toUpperCase()]
  )
  return rows[0] ?? null
}

export async function setLiveSessionState(
  id: string, status: LiveSessionStatus, currentQuestionIndex: number
): Promise<void> {
  await pool.query(
    `UPDATE live_sessions SET status = $2, current_question_index = $3 WHERE id = $1`,
    [id, status, currentQuestionIndex]
  )
}

// Self-paced only — "Завершить" just stops the session accepting NEW joins;
// it deliberately does NOT touch any participant's own progress/results
// (unlike finishLiveSession below, which is the paced-mode aggregate-and-
// close path). A self-paced student's own finished_at is what ends their
// attempt, independent of this.
export async function closeLiveSession(id: string): Promise<void> {
  await pool.query(
    `UPDATE live_sessions SET status = 'finished', finished_at = NOW() WHERE id = $1`,
    [id]
  )
}

export async function finishLiveSession(id: string, results: LiveQuestionResult[]): Promise<void> {
  await pool.query(
    `UPDATE live_sessions SET status = 'finished', results = $2, finished_at = NOW() WHERE id = $1`,
    [id, JSON.stringify(results)]
  )
}

export async function addParticipant(sessionId: string, nickname?: string): Promise<LiveParticipantRow> {
  const token = randomBytes(24).toString('hex')
  const { rows } = await pool.query<LiveParticipantRow>(
    `INSERT INTO live_participants (session_id, participant_token, nickname) VALUES ($1, $2, $3) RETURNING *`,
    [sessionId, token, nickname ?? null]
  )
  return rows[0]
}

export async function getParticipantByToken(sessionId: string, token: string): Promise<LiveParticipantRow | null> {
  const { rows } = await pool.query<LiveParticipantRow>(
    `SELECT * FROM live_participants WHERE session_id = $1 AND participant_token = $2`,
    [sessionId, token]
  )
  return rows[0] ?? null
}

export async function getParticipantCount(sessionId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM live_participants WHERE session_id = $1`,
    [sessionId]
  )
  return parseInt(rows[0].count, 10)
}

// Relies on the (participant_id, question_index) unique constraint — catches
// the violation and reports "already answered" rather than throwing, so the
// route layer doesn't need to pre-check under a race (two rapid taps).
export async function recordAnswer(
  participantId: string, sessionId: string, questionIndex: number, choiceIndex: number
): Promise<{ recorded: boolean }> {
  try {
    await pool.query(
      `INSERT INTO live_answers (id, session_id, participant_id, question_index, choice_index) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), sessionId, participantId, questionIndex, choiceIndex]
    )
    return { recorded: true }
  } catch (err) {
    if ((err as { code?: string }).code === '23505') return { recorded: false }
    throw err
  }
}

// All of one participant's answers, question_index -> choice_index. Powers
// both "did they answer the current question / what did they pick" (reveal
// screen) and the final per-participant score (sum against the quiz's own
// correct_index once the session is finished) — one query serves both
// rather than a separate hasAnswered() round-trip per use.
export async function getParticipantAnswers(participantId: string): Promise<Record<number, number>> {
  const { rows } = await pool.query<{ question_index: number; choice_index: number }>(
    `SELECT question_index, choice_index FROM live_answers WHERE participant_id = $1`,
    [participantId]
  )
  const answers: Record<number, number> = {}
  for (const row of rows) answers[row.question_index] = row.choice_index
  return answers
}

// Self-paced only — advances a participant's own pointer to the next
// question. Guarded by `current_question_index < $2` so a retried/duplicate
// request can't advance them twice (idempotent under a race, same posture
// as recordAnswer's unique-constraint guard).
export async function advanceParticipant(participantId: string, nextIndex: number): Promise<void> {
  await pool.query(
    `UPDATE live_participants SET current_question_index = $2 WHERE id = $1 AND current_question_index < $2`,
    [participantId, nextIndex]
  )
}

export async function finishParticipant(participantId: string): Promise<void> {
  await pool.query(
    `UPDATE live_participants SET finished_at = NOW() WHERE id = $1 AND finished_at IS NULL`,
    [participantId]
  )
}

// Host roster / "who got what points" view — one row per participant,
// ordered by join time, each carrying their raw answers (question_index ->
// choice_index) so the route layer can score them against the quiz's own
// correct_index (a DB-layer concern-separation: this file doesn't know what
// "correct" means, only what was answered). One query via json_object_agg
// rather than a per-participant getParticipantAnswers() round-trip — this
// runs on every host poll, so N+1 here would mean N+1 every ~2s.
// Lecture-hall sized (tens, not thousands), no pagination needed.
export interface ParticipantWithAnswers {
  id:                      string
  nickname:                string | null
  current_question_index: number
  finished_at:             string | null
  already_saved:           boolean
  answers:                 Record<string, number>
}

export async function getSessionParticipants(sessionId: string): Promise<ParticipantWithAnswers[]> {
  const { rows } = await pool.query<ParticipantWithAnswers>(
    `SELECT lp.id, lp.nickname, lp.current_question_index, lp.finished_at,
            (lp.assignment_id IS NOT NULL) AS already_saved,
            COALESCE(
              (SELECT json_object_agg(la.question_index, la.choice_index)
                 FROM live_answers la WHERE la.participant_id = lp.id),
              '{}'
            ) AS answers
     FROM live_participants lp
     WHERE lp.session_id = $1
     ORDER BY lp.joined_at ASC`,
    [sessionId]
  )
  return rows
}

// Ownership-scoped lookup for the save-to-journal endpoint — a participant
// id alone isn't enough to trust, it must also belong to the session the
// requesting teacher owns (checked by the caller via getLiveSessionById).
export async function getParticipantById(id: string, sessionId: string): Promise<LiveParticipantRow | null> {
  const { rows } = await pool.query<LiveParticipantRow>(
    `SELECT * FROM live_participants WHERE id = $1 AND session_id = $2`,
    [id, sessionId]
  )
  return rows[0] ?? null
}

// Marks a participant as saved to the journal — the idempotency guard that
// lets the teacher re-open the review screen and save again without
// double-creating assignment rows for participants already saved.
export async function linkParticipantAssignment(participantId: string, assignmentId: string): Promise<void> {
  await pool.query(
    `UPDATE live_participants SET assignment_id = $2 WHERE id = $1`,
    [participantId, assignmentId]
  )
}

// Mapped into a fixed length-4 array (options are always exactly 4, per
// QuizQuestion's contract) so the frontend never has to sparse-index.
export async function getAnswerCounts(sessionId: string, questionIndex: number): Promise<number[]> {
  const { rows } = await pool.query<{ choice_index: number; count: string }>(
    `SELECT choice_index, COUNT(*)::text AS count FROM live_answers
     WHERE session_id = $1 AND question_index = $2 GROUP BY choice_index`,
    [sessionId, questionIndex]
  )
  const counts = [0, 0, 0, 0]
  for (const row of rows) {
    if (row.choice_index >= 0 && row.choice_index < 4) counts[row.choice_index] = parseInt(row.count, 10)
  }
  return counts
}
