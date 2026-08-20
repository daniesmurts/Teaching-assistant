-- Migration 114 — Кабинет методиста (TODO.md Feature AM, Phase 2): async
-- check runs.
--
-- Phase 1 ran each selected check (§5-§8 coverage, competency coverage,
-- «место в структуре», МТО) as its own synchronous mutation straight from
-- the browser — fine for one check, but «run all four» meant four
-- concurrently-held HTTP sockets waiting on separate LLM calls. Same fix as
-- presentations (102), grading (077), ФОС (X): enqueue via pg-boss, persist
-- a row before responding, poll for status.
--
-- Deliberately does NOT duplicate check results — `checks` is an array of
-- pointers, each holding either a `result_id` into the table the check
-- already writes to (program_document_reviews / program_placement_reviews /
-- program_mto_reviews — unchanged, still the source of truth read by the
-- programme's own Report tab) or, for `syllabus` (which has no dedicated
-- table anywhere in the codebase — routes/curriculum.ts's endpoint has
-- always returned it inline, never persisted), the review JSON itself.
CREATE TABLE IF NOT EXISTS methodist_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  program_id     UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id  UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  requested_checks TEXT[] NOT NULL,      -- subset of ('syllabus','coverage','placement','mto')
  status         TEXT NOT NULL DEFAULT 'queued',  -- queued|processing|ready|failed
  checks         JSONB,                  -- CheckOutcome[] once done (services/methodist/checks.ts)
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS methodist_runs_teacher_idx ON methodist_runs (teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS methodist_runs_discipline_idx ON methodist_runs (discipline_id, created_at DESC);
