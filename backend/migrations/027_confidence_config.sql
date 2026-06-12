-- Migration 027 — calibrated confidence thresholds.
--
-- The confidence labels start from heuristic dispersion cut-offs (confidence.ts
-- defaults). Once a confidence eval run has teacher ground truth, the admin can
-- fit data-driven thresholds and persist them here; classifyConfidence reads
-- this single row (falling back to the built-in defaults when empty).

CREATE TABLE IF NOT EXISTS confidence_config (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE,   -- single-row table (id = TRUE)
  high_std_max NUMERIC(6,2) NOT NULL,
  low_std_min  NUMERIC(6,2) NOT NULL,
  run_id       UUID REFERENCES eval_runs(id) ON DELETE SET NULL,
  n_high       INTEGER,
  n_low        INTEGER,
  fitted_at    TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT confidence_config_singleton CHECK (id = TRUE)
);
