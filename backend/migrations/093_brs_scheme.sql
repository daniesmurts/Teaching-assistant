-- Feature AE v1 — БРС engine (TODO.md "### AE"): extract the
-- балльно-рейтинговая система scheme already declared inside a course's РПД
-- and make it the semester scoring ledger. Per-course teacher data (unlike
-- AA's platform-wide ФГОС registry) — schemes are scoped to (course_id,
-- teacher_id), never shared across teachers.
--
-- Versioning: a new extraction/edit of an already-published scheme creates a
-- NEW row (course_id, version = max+1), never an UPDATE of a published row.
-- assignments.brs_checkpoint_id keeps pointing at whichever checkpoint (and
-- thus scheme version) was live when a score was recorded, so historical
-- accruals stay reproducible even after a mid-semester scheme change (rule
-- #5 append-only posture, applied at the scheme level). "Current scheme for
-- a course" = status='published' ORDER BY version DESC LIMIT 1. A draft row
-- (not yet published) CAN be updated in place — only publishing is the
-- irreversible step that should bump to a new version on a re-edit.
--
-- grade_thresholds is JSONB, not a separate table: a small (3-4 row), fixed-
-- shape array of {min_points, max_points, grade_label}, always read/written
-- as a whole alongside its scheme, never queried independently or joined.

CREATE TABLE IF NOT EXISTS brs_schemes (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id         UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  teacher_id        UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  version           INT NOT NULL DEFAULT 1,
  title             TEXT,
  grade_thresholds  JSONB NOT NULL DEFAULT '[]',   -- [{min_points,max_points,grade_label}]
  status            TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  source_excerpt    TEXT,                          -- РПД text the draft was extracted from (audit/debug)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (course_id, version)
);

CREATE INDEX IF NOT EXISTS brs_schemes_course_idx  ON brs_schemes (course_id, status, version DESC);
CREATE INDEX IF NOT EXISTS brs_schemes_teacher_idx ON brs_schemes (teacher_id);

CREATE TABLE IF NOT EXISTS brs_checkpoints (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brs_scheme_id         UUID NOT NULL REFERENCES brs_schemes(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,        -- e.g. "КТ-1 Контрольная работа"
  max_points            NUMERIC NOT NULL,
  checkpoint_type       TEXT NOT NULL DEFAULT 'graded' CHECK (checkpoint_type IN ('graded', 'manual')),
  is_verbatim_verified  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order            INT NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS brs_checkpoints_scheme_idx ON brs_checkpoints (brs_scheme_id, sort_order);

-- Checkpoint link on every scoring-event row. Nullable, ON DELETE SET NULL —
-- same precedent as published_assignment_id (migration 046) and
-- live_participants.assignment_id (migration 083): a link that can vanish
-- without taking the underlying grade row down with it.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS brs_checkpoint_id UUID REFERENCES brs_checkpoints(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS assignments_brs_checkpoint_idx ON assignments (brs_checkpoint_id);

-- approved_revisions is append-only (rule #5) — recording brs_checkpoint_id
-- here too means the audit trail shows what each historical approval
-- counted toward, not just the current assignments row.
ALTER TABLE approved_revisions ADD COLUMN IF NOT EXISTS brs_checkpoint_id UUID REFERENCES brs_checkpoints(id) ON DELETE SET NULL;

-- Manual point entries for 'manual'-type checkpoints (посещение/активность)
-- that have no underlying AI-graded assignment to link. Append-only by
-- convention (no update endpoint in v1) — a correction is a new row plus a
-- note, matching the rest of this codebase's audit posture.
CREATE TABLE IF NOT EXISTS brs_manual_entries (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  brs_checkpoint_id  UUID NOT NULL REFERENCES brs_checkpoints(id) ON DELETE CASCADE,
  teacher_id         UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  student_name       TEXT NOT NULL,
  student_group      TEXT,
  points             NUMERIC NOT NULL,
  note               TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS brs_manual_entries_checkpoint_idx ON brs_manual_entries (brs_checkpoint_id);
CREATE INDEX IF NOT EXISTS brs_manual_entries_student_idx    ON brs_manual_entries (student_name, student_group);
