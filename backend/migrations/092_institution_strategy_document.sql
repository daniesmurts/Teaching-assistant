-- Migration 092 — РОП Студия's Plane-2 document (TODO.md Feature Z, Phase 0
-- pilot completion). Z's own pilot definition asks for one grounded
-- document — the university's «стратегия развития» — alongside the
-- Plane-1 market data shipped in migrations 089-091, so the generated
-- «обоснование актуальности» can also cite the university's own strategic
-- priorities, verbatim, next to the vacancy/профстандарт sources.
--
-- Deliberately NOT a general document-scope tier (platform/institution/
-- programme) — that's Z Phase 1b, gated on real demand from this pilot.
-- This is exactly one document per institution: institution_id is UNIQUE,
-- so a re-upload replaces (delete-then-insert; chunks cascade). Mirrors
-- documents/document_chunks' shape (migration 004) but scoped by
-- institution_id instead of course_id — kept as separate tables rather
-- than widening documents/document_chunks' scope semantics, since that
-- pair's retrieval (db/queries/chunks.ts) is hard-scoped to course_id
-- throughout and this document has no course.

CREATE TABLE IF NOT EXISTS institution_strategy_documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id    UUID NOT NULL UNIQUE REFERENCES institutions(id) ON DELETE CASCADE,
  file_name         TEXT NOT NULL,
  storage_path      TEXT NOT NULL,
  extracted_text    TEXT,
  processing_status TEXT NOT NULL DEFAULT 'pending', -- pending|extracting|chunking|ready|failed
  error_message     TEXT,
  uploaded_by       UUID REFERENCES teachers(id) ON DELETE SET NULL,
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS institution_strategy_chunks (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID NOT NULL REFERENCES institution_strategy_documents(id) ON DELETE CASCADE,
  chunk_index    INT NOT NULL,
  text           TEXT NOT NULL,
  embedding      vector(256), -- Yandex text-search-doc is 256-dim, not 1536 (migration 024)
  page_start     INT,
  page_end       INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS institution_strategy_chunks_document_idx
  ON institution_strategy_chunks (document_id);

-- Persists whichever strategy excerpts (if any) grounded a given
-- generation, alongside the vacancy_snapshot/profstandard_refs already
-- stored — same "show the raw source next to the prose" posture. Defaults
-- to '[]' (Plane-2 is optional per generation: no document uploaded, or no
-- excerpt cleared the relevance gate, both leave this empty rather than
-- erroring).
ALTER TABLE program_market_evidence
  ADD COLUMN IF NOT EXISTS strategy_excerpts JSONB NOT NULL DEFAULT '[]';
