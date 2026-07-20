-- Migration 084 — Retain РПД history across re-uploads + year-over-year diff.
--
-- Before this migration, re-uploading a discipline's рабочая программа
-- hard-deleted the previous program_documents row (see
-- deleteWorkingProgrammeForDiscipline), cascading away its
-- program_document_reviews row too. There was nothing left to compare a new
-- upload against. This migration switches that re-upload to a soft
-- "supersede" so the previous extraction survives (Research.md §9.6 — РПД
-- year-over-year diff), and adds the table that caches the comparison.
--
-- Scope is deliberately limited to kind='working_programme' — practice
-- documents (kind='practice') keep their existing hard-replace behaviour
-- (deletePracticeForType), unaffected by this migration.

ALTER TABLE program_documents ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;

-- At most one CURRENT working_programme row per discipline — mirrors the
-- practice_type partial unique index from migration 054. App logic already
-- serialises supersede-then-insert; this is belt-and-suspenders.
CREATE UNIQUE INDEX IF NOT EXISTS program_documents_current_working_programme_uq
  ON program_documents (discipline_id)
  WHERE kind = 'working_programme' AND superseded_at IS NULL;

-- One row per (old, new) document pair — cached so reopening the diff panel
-- doesn't re-run the LLM comparison for a pair already compared.
CREATE TABLE IF NOT EXISTS program_document_diffs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id      UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id   UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  old_document_id UUID NOT NULL REFERENCES program_documents(id) ON DELETE CASCADE,
  new_document_id UUID NOT NULL REFERENCES program_documents(id) ON DELETE CASCADE,
  result          JSONB NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS program_document_diffs_pair_uq
  ON program_document_diffs (old_document_id, new_document_id);
CREATE INDEX IF NOT EXISTS program_document_diffs_discipline_idx
  ON program_document_diffs (discipline_id, created_at DESC);
