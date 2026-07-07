-- Migration 065 — criterion-level RAG retrieval (TODO Improvement #9).
--
-- Second, finer-grained RAG tier alongside whole-assignment retrieval
-- (assignments.embedding). One row per (assignment, criterion) pair with
-- non-trivial approved feedback — embedded and stored on approval, queried
-- at grading time using the submission's own embedding (no extra embed()
-- call at query time). Own-course only for v1 — no institution-pool union
-- (see services/grading.ts findSimilarCriterionExamples call site for
-- rationale).
--
-- Criteria are ephemeral snapshots (criteria_snapshot JSONB, not FK-based),
-- so matching is by LOWER(criterion_name), never criterion_id.

CREATE TABLE IF NOT EXISTS criterion_rag_examples (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id  UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id      UUID NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  criterion_name TEXT NOT NULL,
  score          INTEGER NOT NULL,
  feedback       TEXT NOT NULL,
  embedding      vector(256),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS criterion_rag_examples_embedding_idx
  ON criterion_rag_examples USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS criterion_rag_examples_course_name_idx
  ON criterion_rag_examples (course_id, LOWER(criterion_name));
