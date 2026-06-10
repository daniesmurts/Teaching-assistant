-- Migration 018 — assignment revisions.
-- When a student resubmits an improved version, the new assignment is linked
-- to the previous one. The grading service uses the parent's feedback as
-- context, and the AI returns a structured "was this improvement actually
-- addressed?" check that's stored alongside the grade.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS parent_assignment_id UUID
    REFERENCES assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS revision_number     INTEGER NOT NULL DEFAULT 1,
  -- ai_revision_check: array of { point, status, note } objects.
  -- status ∈ {'addressed', 'partial', 'not_addressed'}
  ADD COLUMN IF NOT EXISTS ai_revision_check   JSONB;

-- Lookup index — "show me revisions of this assignment".
CREATE INDEX IF NOT EXISTS assignments_parent_idx
  ON assignments (parent_assignment_id)
  WHERE parent_assignment_id IS NOT NULL;
