-- Migration 123 — кафедральный банк лекций (TODO.md "### AO" Phase 2/4 follow-up).
--
-- Phase 2 shipped the flywheel scoped to a teacher's own approved decks, and
-- deliberately stopped there: pooling one teacher's material into a
-- colleague's generation is what CLAUDE.md invariant 7 gates behind explicit
-- flags for documents, and presentations had no such flag. This is that flag.
--
-- Same ladder as documents (migration 116), same vocabulary, same ancestor
-- semantics — a deck shared to /root/faculty is visible to everyone whose own
-- unit path starts with it (db/queries/chunks.ts's SCOPE_WHERE). Two
-- deliberate differences:
--
--   * The default is 'private', not documents' 'course'. A document is
--     uploaded *to* a course and is course material by nature; a lecture deck
--     is the teacher's own work until they say otherwise.
--   * There is no 'institution' rung. For documents it means "the institution
--     pools reference material", which is meaningful. For a deck used as a
--     *style* exemplar it is not: teaching voice is a кафедра-level thing, and
--     a wider blast radius for cross-teacher prompt content buys nothing.
--     Adding it later is one enum value; removing it would not be.
--
-- Expand/contract (CLAUDE.md invariant 12): additive column with a default
-- plus a nullable FK; the previous release ignores both.

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS visibility_scope TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS scope_unit_id    UUID REFERENCES org_units(id) ON DELETE SET NULL;

-- The exemplar lookup and the кафедра bank both ask the same question: "decks
-- shared to a unit, approved, newest first". Partial — a private deck (the
-- overwhelming majority) never enters either query.
CREATE INDEX IF NOT EXISTS presentations_shared_idx
  ON presentations (scope_unit_id, approved_at DESC)
  WHERE visibility_scope = 'unit' AND approved_at IS NOT NULL;
