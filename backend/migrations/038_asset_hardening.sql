-- Migration 038 — make the approved grade a fuller structured asset.
-- Three additions that turn approved rows from "score + comment" into
-- queryable institutional judgment:
--
--   1. approved_criteria_scores — per-criterion edits, mirroring the AI's
--      ai_criteria_scores shape. Previously only the overall approved_score
--      was captured.
--   2. approved_edit_reason — opt-in taxonomy of WHY the teacher edited the
--      AI draft. Turns the edit corpus into a richer training/audit signal.
--   3. approved_revisions — full audit trail of every approve mutation.
--      Approvals become versioned instead of versionless.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS approved_criteria_scores JSONB,
  ADD COLUMN IF NOT EXISTS approved_edit_reason     TEXT;

-- CHECK constraint added separately so re-running on a DB that already has
-- the column (without the constraint) is a no-op for the column add and
-- only the constraint creation matters.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_approved_edit_reason_chk'
  ) THEN
    ALTER TABLE assignments
      ADD CONSTRAINT assignments_approved_edit_reason_chk
      CHECK (approved_edit_reason IS NULL OR approved_edit_reason IN
             ('fact_check', 'tone', 'criterion_weight', 'scale', 'scope', 'other'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS approved_revisions (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id            UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  approved_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  actor_teacher_id         UUID REFERENCES teachers(id) ON DELETE SET NULL,
  approved_score           INTEGER,
  approved_grade           TEXT,
  approved_feedback        TEXT,
  approved_strengths       JSONB,
  approved_improvements    JSONB,
  approved_criteria_scores JSONB,
  approved_edit_reason     TEXT
);

CREATE INDEX IF NOT EXISTS approved_revisions_assignment_idx
  ON approved_revisions (assignment_id, approved_at DESC);
