-- Migration 127 — merging duplicate student identities.
--
-- A student is not a row anywhere: identity is the (student_name,
-- student_group) text pair the teacher typed on each work, and every roster,
-- trajectory, cohort rollup and БРС ledger is a GROUP BY over it. So the same
-- person entered as «Алтышев Н.И» once and «Алтышев Назар Игоревич · 251-МО21»
-- the next time is two students with one work each — split average, split
-- history, split ledger.
--
-- The merge REWRITES the identity columns onto the target spelling rather than
-- adding an alias layer the read path has to resolve. Deliberate: those pairs
-- are read in ~8 query sites across five tables, and an alias layer means every
-- one of them has to remember to resolve — the one that forgets shows a ghost
-- student, and nothing fails loudly when it does. A rewrite means every reader
-- is correct the moment the transaction commits, with no read-path change at
-- all.
--
-- What the rewrite costs is the original spelling, and this table buys it back:
-- the exact row ids touched per table, so an undo restores precisely what the
-- merge changed and nothing that arrived under the target name afterwards.
-- Append-only in the sense of rule #5 — an undo sets undone_at, it never
-- deletes the row.
--
-- Additive only: nothing reads this table until the merge endpoints ship, so
-- rolling back to the previous image leaves an unused table behind rather than
-- a broken one (rule 12).

CREATE TABLE IF NOT EXISTS student_merges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id   UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,

  -- The identity that was rewritten away, and the one it became.
  from_name    TEXT NOT NULL,
  from_group   TEXT,
  to_name      TEXT NOT NULL,
  to_group     TEXT,

  -- {"assignments": ["<uuid>", …], "long_reviews": [...], …} — exactly the rows
  -- this merge touched, per table. Undo replays from_name/from_group onto these
  -- ids only.
  rewritten    JSONB NOT NULL DEFAULT '{}'::jsonb,
  row_count    INTEGER NOT NULL DEFAULT 0,

  -- 'suggested' when the teacher accepted a proposed pair, 'manual' when they
  -- picked both sides themselves. Tells us later whether the matcher is
  -- earning its keep.
  source       TEXT NOT NULL DEFAULT 'manual',

  merged_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  undone_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS student_merges_teacher_idx
  ON student_merges (teacher_id, merged_at DESC);
