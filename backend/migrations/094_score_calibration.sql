-- Feature AF v1 — per-scope score calibration (Research §10.1).
--
-- Fitted isotonic calibration maps, one row per (scope_type, scope_id). A
-- grade's raw AI score is corrected through the most specific map available
-- at grading time: course -> teacher -> institution -> none (pass through).
-- Fitting reads (ai_score, approved_score) pairs straight off `assignments`
-- history (see services/scoreCalibration.ts) and is triggered explicitly
-- (admin route), not on every grade — grading only ever does a cached read.

CREATE TABLE IF NOT EXISTS score_calibration (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope_type  TEXT NOT NULL CHECK (scope_type IN ('course', 'teacher', 'institution')),
  scope_id    UUID NOT NULL,
  points      JSONB NOT NULL,        -- [{x, y}, ...] sorted ascending by x, monotone non-decreasing y
  sample_size INTEGER NOT NULL,
  fitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scope_type, scope_id)
);
