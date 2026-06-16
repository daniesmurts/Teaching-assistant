-- Migration 033 — log RAG retrievals as their own audit trail.
--
-- Every time a new grading call pulls a past approved assignment as a
-- few-shot example, write one row here. Two payoffs:
--
--   1. Powers the «использовано как образец» metric on the Learning Loop
--      page — teacher sees how often their past judgment is actually being
--      reused by the system.
--   2. Future-proofs Phase 3 (institutional flywheel): once retrieval can
--      pull from the institution pool, this table is already the audit log
--      we'd need.
--
-- ON DELETE CASCADE in both directions so rows die with their assignments.

CREATE TABLE IF NOT EXISTS rag_retrievals (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  grading_assignment_id   UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  retrieved_assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  similarity_score        REAL,
  retrieved_at            TIMESTAMPTZ DEFAULT NOW()
);

-- The hot read query is "how many times was THIS teacher's work used as an
-- example in the last N days?", so the index leads with retrieved id.
CREATE INDEX IF NOT EXISTS rag_retrievals_retrieved_idx
  ON rag_retrievals (retrieved_assignment_id, retrieved_at DESC);

-- Reverse lookup ("which examples did this grade use?") covers debugging and
-- future eval-harness inspection.
CREATE INDEX IF NOT EXISTS rag_retrievals_grading_idx
  ON rag_retrievals (grading_assignment_id);
