-- Migration 083 — link live-quiz participants to journal entries.
--
-- Live-quiz scores previously lived only in live_participants/live_answers,
-- isolated from the `assignments` table that powers История, student
-- trajectory, and cohort analytics. A teacher can now review and save
-- selected participants' results into the journal as real (already-
-- approved) assignment rows. assignment_id marks a participant as already
-- saved — the save endpoint skips anyone with it set, so re-opening the
-- review screen and saving again never double-creates journal entries.

ALTER TABLE live_participants ADD COLUMN IF NOT EXISTS assignment_id UUID REFERENCES assignments(id) ON DELETE SET NULL;
