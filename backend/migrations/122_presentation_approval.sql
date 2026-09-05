-- Migration 122 — «Готово» on a lecture deck (TODO.md "### AO" Phase 2).
--
-- Phase 1 gave the feature its first real quality signal (which slides get
-- rewritten). This is the other half: which finished decks the teacher stands
-- behind, so that generation can learn the way *this* teacher's slides read.
--
-- Approval is the gate, exactly as it is for grading (CLAUDE.md invariant 3:
-- AI output is never a training signal until a teacher has reviewed it). The
-- deliberate difference from the plan's original wording: an approved deck's
-- *edited* slides are the best examples in it, not the worst — a slide the
-- teacher rewrote is their own writing, the same way the flywheel for grading
-- learns from the teacher-corrected grade rather than the model's first
-- attempt. So approval endorses the whole deck; `presentation_slide_events`
-- stays the measurement, not the selector. (It could not be the selector
-- anyway: it keys on slide_index, which migration 119's own comment calls a
-- breadcrumb, and indices shift under insert/delete/reorder — unreliable
-- precisely in the decks that were edited most.)
--
-- Expand/contract (CLAUDE.md invariant 12): one additive nullable column plus
-- an index; the previous release runs unchanged against this schema.

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;

-- Exemplar lookup: "this teacher's approved decks, newest first, this course
-- first". Partial — an unapproved deck is never a candidate, and most decks
-- will never be approved.
CREATE INDEX IF NOT EXISTS presentations_approved_idx
  ON presentations (teacher_id, course_id, approved_at DESC)
  WHERE approved_at IS NOT NULL;
