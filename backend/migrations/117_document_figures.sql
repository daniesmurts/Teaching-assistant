-- Migration 117 — Кафедральная библиотека Phase 2 (TODO.md "### AN"): a
-- retrievable figure library, so drawings survive ingestion instead of being
-- OCR'd for text and discarded (documentExtractor.ts's ocrDocxImages). Same
-- scope-ladder columns as document_chunks (migration 116), inherited from
-- the parent document at extraction time.

CREATE TABLE IF NOT EXISTS document_figures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id       UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  figure_index      INTEGER NOT NULL,
  storage_path      TEXT NOT NULL,
  mime_type         TEXT NOT NULL,
  ocr_text          TEXT,             -- text found on the drawing itself (title block, обозначения)
  caption           TEXT,             -- short Russian caption, generated from ocr_text + surrounding chunk text
  caption_embedding vector(256),      -- same dimension as document_chunks.embedding (migration 024)
  width             INTEGER,
  height            INTEGER,
  visibility_scope  TEXT NOT NULL DEFAULT 'course',
  scope_unit_id     UUID REFERENCES org_units(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS document_figures_embedding_idx ON document_figures USING ivfflat (caption_embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS document_figures_scope_idx ON document_figures (visibility_scope, scope_unit_id);
CREATE INDEX IF NOT EXISTS document_figures_document_idx ON document_figures (document_id);

ALTER TABLE rag_document_uses
  ADD CONSTRAINT rag_document_uses_figure_fk FOREIGN KEY (document_figure_id) REFERENCES document_figures(id) ON DELETE CASCADE;
