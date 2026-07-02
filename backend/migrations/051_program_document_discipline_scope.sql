-- Migration 051 — Discipline-scoped рабочая программа + coverage reviews.
--
-- Migration 050 assumed one рабочая программа PDF per programme. In reality
-- КНИТУ's intake carries one per DISCIPLINE (dozens per направление),
-- gathered incrementally, not all at once. This migration:
--   1) lets a 'working_programme' program_documents row point at the specific
--      discipline it belongs to (nullable — 'practice' rows never set it);
--   2) caches extracted text at upload time so the coverage check below
--      doesn't re-parse the PDF on every run;
--   3) adds program_document_reviews — the result of checking a discipline's
--      uploaded РПД against the competencies it claims to develop
--      (program_disciplines.competency_codes), i.e. Feature K scoped to a
--      programme discipline instead of a standalone syllabus upload.

ALTER TABLE program_documents
  ADD COLUMN IF NOT EXISTS discipline_id  UUID REFERENCES program_disciplines(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS extracted_text TEXT;

CREATE INDEX IF NOT EXISTS program_documents_discipline_idx
  ON program_documents (discipline_id) WHERE discipline_id IS NOT NULL;

-- One row per review run; the latest row per discipline_id is what the UI
-- reads (see getLatestReviewByDiscipline). discipline_id is nullable so the
-- same mechanism can later score a practice document against the full
-- competency set instead of one discipline's claimed subset.
CREATE TABLE IF NOT EXISTS program_document_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id     UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id  UUID REFERENCES program_disciplines(id) ON DELETE CASCADE,
  document_id    UUID NOT NULL REFERENCES program_documents(id) ON DELETE CASCADE,
  result         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_document_reviews_program_idx
  ON program_document_reviews (program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS program_document_reviews_discipline_idx
  ON program_document_reviews (discipline_id, created_at DESC);
