-- Feature R backlog item #2: a co-taught Moodle course used to map to
-- whichever teacher launched it first — lti_course_links was keyed by
-- (institution_id, deployment_id, context_id) alone, so a second instructor
-- launching the same Moodle course was silently handed the first teacher's
-- course_id, which 404s for them downstream (courses queries are strictly
-- `WHERE teacher_id = $2`). Re-keying per teacher gives every co-teacher
-- their own auto-created course for the same Moodle context — the same
-- "first launch auto-creates a course" behaviour every teacher already gets
-- today, just no longer broken for the 2nd+ teacher.

ALTER TABLE lti_course_links
  ADD COLUMN IF NOT EXISTS teacher_id UUID REFERENCES teachers(id) ON DELETE CASCADE;

-- Backfill: every existing row already has exactly one owning teacher via
-- its linked course.
UPDATE lti_course_links l
   SET teacher_id = c.teacher_id
  FROM courses c
 WHERE c.id = l.course_id
   AND l.teacher_id IS NULL;

ALTER TABLE lti_course_links
  DROP CONSTRAINT IF EXISTS lti_course_links_institution_id_deployment_id_context_id_key;

ALTER TABLE lti_course_links
  ADD CONSTRAINT lti_course_links_institution_deployment_context_teacher_key
  UNIQUE (institution_id, deployment_id, context_id, teacher_id);
