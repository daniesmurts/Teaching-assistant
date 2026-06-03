-- Migration 004 — document processing (uploads + knowledge chunks)

CREATE TABLE IF NOT EXISTS documents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id        UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id         UUID REFERENCES courses(id) ON DELETE SET NULL,
  file_name         TEXT NOT NULL,
  file_type         TEXT NOT NULL,        -- 'pdf' | 'docx' | 'image'
  mime_type         TEXT NOT NULL,
  file_size_bytes   INTEGER,
  storage_path      TEXT NOT NULL,        -- path in object storage (or local in dev)
  document_type     TEXT NOT NULL,        -- 'assignment' | 'syllabus' | 'material'
  extracted_text    TEXT,
  extraction_method TEXT,                 -- 'text_layer' | 'ocr' | 'docx'
  token_estimate    INTEGER,
  page_count        INTEGER,
  processing_status TEXT NOT NULL DEFAULT 'pending', -- 'pending'|'extracting'|'chunking'|'ready'|'failed'
  error_message     TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS documents_teacher_idx ON documents (teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS documents_course_idx  ON documents (course_id);

CREATE TABLE IF NOT EXISTS document_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id     UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  course_id       UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  chunk_index     INTEGER NOT NULL,
  chunk_type      TEXT,                   -- 'overview'|'schedule'|'assessment'|'reading_list'|'general'
  text            TEXT NOT NULL,
  token_estimate  INTEGER,
  embedding       vector(1536),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
  ON document_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS document_chunks_course_type_idx
  ON document_chunks (course_id, chunk_type);
