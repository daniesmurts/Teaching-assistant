-- Migration 025 — grading confidence (ensemble / triage).
--
-- "Thorough" grading samples an ensemble of grader variants and derives a
-- confidence label from their disagreement. Both columns are nullable: normal
-- (single-pass) grades leave them NULL, so existing rows and the default path
-- are unaffected.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS ai_confidence TEXT,   -- 'high' | 'medium' | 'low'
  ADD COLUMN IF NOT EXISTS ai_ensemble   JSONB;  -- { samples[], score_std, score_spread, grade_agreement }

-- History triage: let the teacher filter/sort by confidence cheaply.
CREATE INDEX IF NOT EXISTS assignments_confidence_idx
  ON assignments (teacher_id, ai_confidence)
  WHERE ai_confidence IS NOT NULL;
