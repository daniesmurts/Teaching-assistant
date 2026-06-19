-- Migration 040 — generalise the «Задания» generator into a materials generator.
-- task_sets now stores all practical-material kinds (assignment / case / project);
-- the item shape (title/statement/skills/guidance) is shared, the prompt differs
-- per kind. Table name kept to avoid churn — it is the materials store.

ALTER TABLE task_sets
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'assignment';
  -- kind: assignment | case | project
