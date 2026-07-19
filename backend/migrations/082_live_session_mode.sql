-- Migration 082 — self-paced live quiz mode (TODO.md Feature Y follow-up).
--
-- Classroom testing surfaced that lockstep teacher-paced pacing forces fast
-- students to wait and slow students to rush, and opens a "watch your
-- neighbour" timing risk on tests that don't need group discussion.
--
-- live_sessions.status/current_question_index keep their existing meaning
-- for mode='paced' (unchanged). For mode='self_paced', status only ever
-- tracks lobby -> question -> finished at the SESSION level (a coarse
-- open/closed marker for new joins) — real per-student progress lives on
-- live_participants.current_question_index/finished_at, independent of
-- whether the teacher has "finished" the session.

ALTER TABLE live_sessions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'paced';

ALTER TABLE live_participants ADD COLUMN IF NOT EXISTS current_question_index INT NOT NULL DEFAULT 0;
ALTER TABLE live_participants ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
