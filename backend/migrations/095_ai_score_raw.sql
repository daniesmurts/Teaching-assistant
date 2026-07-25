-- Migration 095 — preserve the pre-calibration AI score (Feature AF follow-up).
--
-- Feature AF (migration 094) applies a fitted calibration map to the model's
-- score before persisting it into assignments.ai_score. But the calibration
-- REFIT reads that same column, so once a map is live every refit would learn
-- "already-calibrated score -> teacher score" instead of "raw model score ->
-- teacher score", while inference keeps feeding it a raw score. Train and
-- inference distributions drift apart and the correction compounds with each
-- refit.
--
-- Fix: keep the raw score alongside. Fitting reads
-- COALESCE(ai_score_raw, ai_score) — correct with no backfill, because every
-- row written before this migration was graded with no calibration map fitted
-- (applyCalibration passed the score through unchanged), so those rows'
-- ai_score IS the raw score.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS ai_score_raw INTEGER;
