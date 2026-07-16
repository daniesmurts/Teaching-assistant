-- Migration 081 — Live QR quiz (TODO.md Feature Y).
--
-- A teacher runs one of their existing quizzes live in the lecture hall.
-- join_code is a short human-typeable code (distinct from the 48-hex-char
-- opaque tokens used for published-assignment invites — that shape is
-- unusable projected on a screen). Students join anonymously via
-- live_participants; the server-issued participant_token is their sole
-- credential (no account). live_answers enforces answer-once per question
-- via a real DB constraint, not client trust.

CREATE TABLE IF NOT EXISTS live_sessions (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id              UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  quiz_id                 UUID NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
  join_code               TEXT NOT NULL UNIQUE,
  status                  TEXT NOT NULL DEFAULT 'lobby',  -- lobby|question|reveal|finished
  current_question_index INT NOT NULL DEFAULT 0,
  results                 JSONB,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at             TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS live_sessions_teacher_idx ON live_sessions (teacher_id, created_at DESC);

CREATE TABLE IF NOT EXISTS live_participants (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  participant_token TEXT NOT NULL UNIQUE,
  nickname          TEXT,
  joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS live_participants_session_idx ON live_participants (session_id);

CREATE TABLE IF NOT EXISTS live_answers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id     UUID NOT NULL REFERENCES live_sessions(id) ON DELETE CASCADE,
  participant_id UUID NOT NULL REFERENCES live_participants(id) ON DELETE CASCADE,
  question_index INT NOT NULL,
  choice_index   INT NOT NULL,
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (participant_id, question_index)
);
CREATE INDEX IF NOT EXISTS live_answers_session_question_idx ON live_answers (session_id, question_index);
