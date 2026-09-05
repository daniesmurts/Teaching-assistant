-- Migration 124 — remember which lecture a письменная работа came from.
--
-- `POST /api/presentations/:id/assignment` (Phase 3) renders a deck's
-- discussion slides into a draft assignment, but recorded nothing about where
-- it came from — so a second click made a second draft, silently, and the
-- teacher discovered it later in their Задания list. Migration 120 already
-- solved exactly this for tests (`quizzes.presentation_id`); this is the same
-- column on the other side, for the same reason.
--
-- ON DELETE SET NULL, as with quizzes: an assignment can already have student
-- submissions and grades attached, so deleting last term's lecture deck must
-- not take it with it — it simply stops knowing its origin.
--
-- Expand/contract (CLAUDE.md invariant 12): additive and nullable.

ALTER TABLE published_assignments
  ADD COLUMN IF NOT EXISTS presentation_id UUID REFERENCES presentations(id) ON DELETE SET NULL;

-- "Does this deck already have an assignment?" — the read the panel makes on
-- open, so it can offer the existing one instead of quietly making another.
CREATE INDEX IF NOT EXISTS published_assignments_presentation_idx
  ON published_assignments (presentation_id, created_at DESC)
  WHERE presentation_id IS NOT NULL;
