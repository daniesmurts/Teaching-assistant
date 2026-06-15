-- Migration 029 — rubrics as named presets of (criterion, weight) pairs.
--
-- Background: migration 020 dropped the old rubric table in favour of picking
-- individual criteria + weights every time. Teachers asked for that quick-pick
-- back as an *additive* convenience — bundles they save once and load at grade
-- time without losing the ability to tweak afterwards. So rubrics are pure
-- presets; the grading snapshot still records the per-event criteria+weights
-- and never references a rubric id.
--
-- Scoping mirrors `criteria`:
--   teacher_id NULL + is_global_template = TRUE  → platform-wide template
--   teacher_id set + is_institution_shared = TRUE → visible to the teacher's institution
--   otherwise                                     → personal to the teacher

CREATE TABLE IF NOT EXISTS rubrics (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id            UUID REFERENCES teachers(id) ON DELETE CASCADE,
  course_id             UUID REFERENCES courses(id) ON DELETE SET NULL,
  name                  TEXT NOT NULL,
  description           TEXT,
  subject               TEXT,            -- matches criteria.subject vocabulary
  -- JSONB array of { criterion_id: uuid, weight: int 0–100 }, ordered.
  -- Items reference criteria the author was allowed to see at creation time;
  -- if a referenced criterion is later deleted, the rubric picker filters it
  -- out at load time (no FK to keep deletes simple).
  items                 JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_global_template    BOOLEAN NOT NULL DEFAULT FALSE,
  is_institution_shared BOOLEAN NOT NULL DEFAULT FALSE,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rubrics_teacher_idx ON rubrics (teacher_id);
CREATE INDEX IF NOT EXISTS rubrics_global_idx
  ON rubrics (subject) WHERE is_global_template;
CREATE INDEX IF NOT EXISTS rubrics_institution_idx
  ON rubrics (teacher_id) WHERE is_institution_shared;
