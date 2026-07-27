-- Migration 097 — «ответственный за дисциплину» (docs/RPD-WORKFLOW.md, phase 4a).
--
-- Until now nothing recorded WHOSE РПД a programme discipline is. The link
-- `program_disciplines.course_id -> courses.teacher_id` exists but is
-- nullable, indirect, and means something different (which of MY subjects
-- this discipline corresponds to), so it can't answer "who must submit this
-- РПД for review".
--
-- This is also what replaces the rejected `syllabus` access domain
-- (docs/ACCESS-MATRIX.md): the right to author a discipline's РПД is an
-- assigned responsibility, not a subtree grant — a grant would have meant
-- "can edit every РПД in the kafedra", which is not what a teacher gets.
--
-- Nullable on purpose: existing disciplines have no responsible teacher and
-- surface to the РОП as «без ответственного» rather than silently belonging
-- to nobody. ON DELETE SET NULL — deactivating a teacher must not cascade
-- away the discipline itself.

ALTER TABLE program_disciplines
  ADD COLUMN IF NOT EXISTS responsible_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL;

-- The teacher-facing surface (/api/my-syllabi) reads exclusively by this
-- column, so it is the hot path for that query.
CREATE INDEX IF NOT EXISTS program_disciplines_responsible_idx
  ON program_disciplines (responsible_teacher_id)
  WHERE responsible_teacher_id IS NOT NULL;
