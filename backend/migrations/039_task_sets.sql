-- Migration 039 — AI practical-assignment generator («Задания»).
-- Named task_sets (not "assignments") because the assignments table already holds
-- graded student work. Mirrors topic_sets: one row per generated set, JSONB items.

CREATE TABLE IF NOT EXISTS task_sets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id  UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id   UUID REFERENCES courses(id) ON DELETE SET NULL,
  topic       TEXT NOT NULL,                 -- тема, по которой сгенерированы задания
  difficulty  TEXT NOT NULL,                 -- basic|intermediate|advanced
  tasks       JSONB NOT NULL,                -- TaskItem[]
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS task_sets_teacher_idx ON task_sets (teacher_id, created_at DESC);
