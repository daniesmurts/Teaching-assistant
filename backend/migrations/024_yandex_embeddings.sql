-- Migration 024 — switch embedding dimension 1536 → 256.
--
-- Discovery: DeepSeek's API has no /embeddings endpoint — every embedding
-- call since launch 404'd silently (fire-and-forget paths swallowed it), so
-- the RAG flywheel never actually retrieved anything. Both embedding columns
-- are confirmed 100% NULL, which makes this a free schema change.
--
-- New provider: Yandex Foundation Models textEmbedding (text-search-doc),
-- 256-dimensional, accessible inside Russia, billed per call (negligible).
-- Requires the ai.languageModels.user role on the API-key service account.

ALTER TABLE assignments     DROP COLUMN IF EXISTS embedding;
ALTER TABLE assignments     ADD  COLUMN embedding vector(256);

ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE document_chunks ADD  COLUMN embedding vector(256);

CREATE INDEX IF NOT EXISTS assignments_embedding_idx
  ON assignments USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
