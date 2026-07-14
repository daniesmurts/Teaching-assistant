-- Migration 077 — async grade jobs.
-- Regular (single-pass) grading used to be a synchronous HTTP request. Calc
-- grading routes through the DeepSeek reasoner and can chain 2–4 LLM calls,
-- easily exceeding the client's 120s axios timeout: the teacher saw «Ошибка
-- при проверке» while the backend finished fine and quietly persisted the
-- grade. Grading now enqueues via pg-boss (same machinery as long_reviews)
-- and the frontend polls this row — no HTTP timeout can bite, and the job
-- survives a page refresh or PM2 restart.
--
-- The teacher-facing grade still lands in assignments (assignment_id), so
-- history / approval / email reuse applies. `result` stores the finished
-- GradeResponse verbatim so the poll endpoint can hand it to the client
-- without recomputing it from the assignment row.

CREATE TABLE IF NOT EXISTS grade_jobs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|processing|ready|failed
  assignment_id UUID REFERENCES assignments(id) ON DELETE SET NULL,
  result        JSONB,
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS grade_jobs_teacher_idx ON grade_jobs (teacher_id, created_at DESC);
