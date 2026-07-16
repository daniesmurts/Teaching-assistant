import { randomBytes, randomUUID } from 'node:crypto'
import { pool } from '../connection'
import type { LiveSessionStatus, LiveQuestionResult } from '../../../../shared/types'

export interface LiveSessionRow {
  id:                      string
  teacher_id:              string
  quiz_id:                 string
  join_code:               string
  status:                  LiveSessionStatus
  current_question_index: number
  results:                 LiveQuestionResult[] | null
  created_at:              string
  finished_at:             string | null
}

export interface LiveParticipantRow {
  id:                string
  session_id:        string
  participant_token: string
  nickname:          string | null
  joined_at:         string
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

export async function createLiveSession(data: { teacherId: string; quizId: string }): Promise<LiveSessionRow> {
  for (let attempt = 0; attempt < MAX_CODE_ATTEMPTS; attempt++) {
    const code = generateJoinCode()
    try {
      const { rows } = await pool.query<LiveSessionRow>(
        `INSERT INTO live_sessions (teacher_id, quiz_id, join_code) VALUES ($1, $2, $3) RETURNING *`,
        [data.teacherId, data.quizId, code]
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

// Active sessions only — a finished session's code is no longer joinable.
export async function getLiveSessionByCode(code: string): Promise<LiveSessionRow | null> {
  const { rows } = await pool.query<LiveSessionRow>(
    `SELECT * FROM live_sessions WHERE join_code = $1 AND status != 'finished'`,
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

export async function hasAnswered(participantId: string, questionIndex: number): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT 1 FROM live_answers WHERE participant_id = $1 AND question_index = $2`,
    [participantId, questionIndex]
  )
  return rows.length > 0
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
