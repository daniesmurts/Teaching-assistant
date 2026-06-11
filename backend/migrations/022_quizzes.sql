-- Migration 022 — quick-check quizzes.
--
-- Same corpus as the presentation generator (course documents + chunks), same
-- citation contract (sources JSONB, inline [N] markers in the question text).
-- Each row stores the full N-question multiple-choice quiz as `questions` so
-- the frontend can render the answer reveal + per-question citation without
-- another API round-trip.

CREATE TABLE IF NOT EXISTS quizzes (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id      UUID REFERENCES courses(id) ON DELETE SET NULL,
  topic          TEXT NOT NULL,
  level          TEXT,                -- 'recall' | 'understanding' | 'application'
  question_count INTEGER NOT NULL,
  questions      JSONB NOT NULL,      -- [{ question, options[4], correct_index, explanation, citations[] }]
  sources        JSONB,               -- same shape as presentations.sources
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS quizzes_teacher_idx ON quizzes (teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS quizzes_course_idx  ON quizzes (course_id, created_at DESC);

-- Monthly usage is computed by COUNT-on-this-table for the current month
-- (same pattern as topics) — no usage_counters extension needed.
