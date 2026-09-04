-- Migration 116 — Кафедральная библиотека Phase 0 (TODO.md "### AN"): widen
-- document RAG from course-scoped to an org-tree scope ladder, mirroring the
-- pooling institutions.shared_rag_enabled/courses.share_rag_with_institution
-- already give the assignments axis (migration 036). Migration
-- 092_institution_strategy_document.sql deliberately deferred this exact
-- widening ("chunks.ts was hard-scoped to course_id throughout") — this is
-- that widening.
--
-- Expand only (rule #12): course_id stays NOT NULL on document_chunks and
-- keeps its current meaning for every existing row (visibility_scope
-- defaults to 'course', reproducing today's behaviour exactly). The new
-- columns are additive; nothing existing changes shape.

ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS visibility_scope TEXT NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS scope_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS provenance TEXT NOT NULL DEFAULT 'own_work';
-- visibility_scope: 'course' | 'unit' | 'institution' | 'platform'
-- provenance:        'own_work' | 'open_licence' | 'institution_owned' | 'unknown'
-- (free-text, same convention as org_unit_roles.domain — no CHECK constraint,
-- guarded in TS, see backend/src/db/queries/documents.ts)

-- Denormalized onto document_chunks — same rationale as the existing
-- denormalized course_id: retrieval reads document_chunks directly and
-- should never need a join to documents just to filter by scope. Populated
-- from the parent document at chunk-creation time (services/documents.ts).
ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS visibility_scope TEXT NOT NULL DEFAULT 'course',
  ADD COLUMN IF NOT EXISTS scope_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS document_chunks_scope_idx ON document_chunks (visibility_scope, scope_unit_id);

-- Reuse-tracking (Feature AN Phase 3 reads this; Phase 0 only writes it).
-- document_figure_id has no FK yet — document_figures doesn't exist until
-- migration 117, which adds the constraint once the table is there.
CREATE TABLE IF NOT EXISTS rag_document_uses (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_chunk_id      UUID REFERENCES document_chunks(id) ON DELETE CASCADE,
  document_figure_id     UUID,
  document_id            UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  retrieving_course_id   UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  retrieving_teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  cross_scope            BOOLEAN NOT NULL,
  retrieved_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS rag_document_uses_document_idx ON rag_document_uses (document_id, retrieved_at DESC);
