-- Migration 059 — per-course grading policy memos.
--
-- Distils recurring teacher corrections (ai_* vs approved_* deltas in
-- approved_revisions) into a short natural-language memo, injected into
-- every grading prompt for the course alongside the RAG examples. One row
-- per course; regenerated in place as more approvals accumulate.

CREATE TABLE IF NOT EXISTS course_policy_memos (
  course_id      UUID PRIMARY KEY REFERENCES courses(id) ON DELETE CASCADE,
  memo_text      TEXT NOT NULL,
  based_on_count INTEGER NOT NULL,
  generated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  model_used     TEXT
);
