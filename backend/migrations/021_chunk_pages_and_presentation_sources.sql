-- Migration 021 — chunk page tracking + presentation source citations.
--
-- Two adds, both nullable so they don't break existing rows:
--
-- 1. document_chunks gets page_start/page_end so the citation rendered next to
--    a slide bullet can point the teacher at the exact pages in their uploaded
--    syllabus/material. New chunks get these populated by chunker.ts; existing
--    chunks stay NULL until they're re-ingested (we never lie about a page).
--
-- 2. presentations gets a sources JSONB column carrying the resolved citation
--    list: [{ idx, document_id, file_name, page_start?, page_end?, excerpt }].
--    The slide content keeps inline [N] markers; the frontend joins them
--    against this list to render clickable chips.

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS page_start INTEGER,
  ADD COLUMN IF NOT EXISTS page_end   INTEGER;

ALTER TABLE presentations
  ADD COLUMN IF NOT EXISTS sources JSONB;
