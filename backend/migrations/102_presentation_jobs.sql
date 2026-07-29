-- Migration 102 — async presentation generation jobs.
--
-- Presentation generation used to run inline on the request thread
-- (services/presentations.ts's generatePresentation, called straight from
-- POST /api/presentations/generate). That's fine for a handful of teachers,
-- but has no ceiling: nothing bounds how many decks generate concurrently,
-- each holds an LLM socket open for tens of seconds, and a burst (start of
-- semester) risks OOM on the 2GB app VM and cascading 504s as clients retry
-- timed-out requests that are still running server-side.
--
-- Same fix as grading (077_grade_jobs.sql) and long reviews: enqueue via
-- pg-boss, persist a row *before* responding, and let the client poll. This
-- also opens the door to Phase 1 (outline+expansion, multiple LLM calls per
-- deck) without multiplying the number of concurrent HTTP-held sockets —
-- the worker owns the whole generation lifecycle off the request thread.

CREATE TABLE IF NOT EXISTS presentation_jobs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|ready|failed
  presentation_id UUID REFERENCES presentations(id) ON DELETE SET NULL,
  result          JSONB,
  error_message   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS presentation_jobs_teacher_idx ON presentation_jobs (teacher_id, created_at DESC);
