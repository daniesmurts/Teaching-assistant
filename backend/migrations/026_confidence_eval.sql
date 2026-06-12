-- Migration 026 — confidence-eval storage (risk-coverage study).
--
-- The confidence replay runs the grader ensemble over approved assignments and
-- records dispersion + error vs teacher ground truth, so we can plot the
-- risk-coverage curve. Reuses eval_runs (tag the kind); results get their own
-- table since the shape differs from the flywheel's per-K rows.

ALTER TABLE eval_runs
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'flywheel';  -- 'flywheel' | 'confidence'

CREATE TABLE IF NOT EXISTS confidence_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES eval_runs(id) ON DELETE CASCADE,
  assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  consensus_score INTEGER,
  consensus_grade TEXT,
  score_std       NUMERIC(6,2),
  grade_agreement NUMERIC(4,3),
  confidence      TEXT,             -- 'high' | 'medium' | 'low'
  teacher_score   INTEGER NOT NULL,
  teacher_grade   TEXT NOT NULL,
  samples         JSONB,
  duration_ms     INTEGER,
  error           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (run_id, assignment_id)
);

CREATE INDEX IF NOT EXISTS confidence_results_run_idx ON confidence_results (run_id);
