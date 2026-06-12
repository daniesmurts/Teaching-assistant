-- Migration 023 — eval harness (flywheel / triage experiments).
--
-- Offline replay: re-grade approved assignments under controlled conditions
-- (K = number of RAG examples injected) and store the results next to the
-- teacher's ground-truth score. eval_runs groups one experiment; eval_results
-- holds one row per (assignment, K) condition.
--
-- The UNIQUE constraint makes runs resumable: re-executing a run skips
-- conditions that already have a row.

CREATE TABLE IF NOT EXISTS eval_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID REFERENCES teachers(id) ON DELETE CASCADE,
  course_id    UUID REFERENCES courses(id) ON DELETE CASCADE,
  model        TEXT NOT NULL,
  conditions   INTEGER[] NOT NULL,          -- K values, e.g. {0,3,5,10}
  status       TEXT NOT NULL DEFAULT 'running',   -- running | done | failed
  notes        TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS eval_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  k               INTEGER NOT NULL,          -- requested example count
  examples_used   INTEGER NOT NULL,          -- actual count available at that point in time
  replay_score    INTEGER,
  replay_grade    TEXT,
  replay_criteria JSONB,
  -- Ground truth denormalised at replay time (approved values can in theory
  -- be edited later; the experiment must freeze what it compared against).
  teacher_score   INTEGER NOT NULL,
  teacher_grade   TEXT NOT NULL,
  duration_ms     INTEGER,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, assignment_id, k)
);

CREATE INDEX IF NOT EXISTS eval_results_run_idx ON eval_results (run_id, k);
