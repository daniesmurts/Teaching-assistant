-- Migration 128 — изображения из загруженной презентации (TODO.md "### AO"
-- Phase 4 follow-up). The .pptx import read text only, so a lecture whose
-- substance is drawings — a ЖКВН schematic deck reported 2026-09-08 carried
-- 13 pictures in 995 KB — imported as a shell of captions.
--
-- Why a table of its own rather than document_figures (migration 117): a
-- figure belongs to a document, is captioned and embedded, and is RETRIEVABLE
-- — findRelevantFigures pulls it into other teachers' decks by similarity.
-- An imported picture has no caption, no embedding and no business being
-- retrieved; it belongs to exactly one slide of one deck. Reusing that table
-- would mean a nullable document_id and a permanent "…AND document_id IS NOT
-- NULL" on every figure query, which is the kind of shared table that quietly
-- leaks one feature's rows into another's results.

CREATE TABLE IF NOT EXISTS presentation_media (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id UUID NOT NULL REFERENCES presentations(id) ON DELETE CASCADE,
  teacher_id      UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  slide_index     INTEGER NOT NULL,      -- position in the deck at import time
  storage_path    TEXT    NOT NULL,      -- objectStorage key
  mime_type       TEXT    NOT NULL,
  width           INTEGER,
  height          INTEGER,
  bytes           INTEGER NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS presentation_media_presentation_idx ON presentation_media (presentation_id);
-- Account erasure walks by teacher to collect storage keys before the rows go.
CREATE INDEX IF NOT EXISTS presentation_media_teacher_idx ON presentation_media (teacher_id);
