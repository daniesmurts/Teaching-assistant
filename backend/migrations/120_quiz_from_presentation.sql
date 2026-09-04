-- Migration 120 — «Проверить усвоение»: a quiz generated from a lecture deck
-- (TODO.md "### AO" Phase 3, first link).
--
-- The deck, the test and the in-hall live session were three features that
-- never touched: a teacher generated a lecture, then re-described the same
-- material by hand on the Тесты page to get a test out of it. This column is
-- the join — which lecture a test came from — and it is what lets the
-- presentation view offer «Запустить в аудитории» directly, closing
-- материал → лекция → проверка усвоения → журнал inside one product.
--
-- ON DELETE SET NULL, deliberately not CASCADE: a test's results can already
-- be in the gradebook (Feature Y's save-to-journal), so deleting last term's
-- lecture deck must not take a graded test with it. The test simply stops
-- knowing where it came from.
--
-- Expand/contract (CLAUDE.md invariant 12): additive and nullable, so the
-- previous release runs unchanged against this schema.

ALTER TABLE quizzes
  ADD COLUMN IF NOT EXISTS presentation_id UUID REFERENCES presentations(id) ON DELETE SET NULL;

-- "Does this deck already have a test?" — the read the presentation view makes
-- on open, so it can offer «Запустить» instead of «Создать» a second time.
CREATE INDEX IF NOT EXISTS quizzes_presentation_idx
  ON quizzes (presentation_id, created_at DESC)
  WHERE presentation_id IS NOT NULL;
