-- "Оспорить" — teacher highlights an AI-generated bullet/criterion/coverage
-- finding they believe is wrong and gets a fresh, re-grounded verdict instead
-- of a silent apology. Persisted (not just returned to the client) because
-- challenged-and-retracted claims are exactly the regression corpus
-- evalHarness.ts wants, and "which criterion gets challenged most" is a
-- quality signal FEATURES.md/TODO.md can't get any other way.
--
-- assignment_id is nullable — Curriculum Studio coverage findings
-- (source_type = 'syllabus_coverage') are computed live and never persisted
-- (see SyllabusReview in shared/types.ts), so there's no row to point at.
CREATE TABLE IF NOT EXISTS feedback_challenges (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  assignment_id  UUID REFERENCES assignments(id) ON DELETE CASCADE,
  source_type    TEXT NOT NULL,   -- 'grading_bullet' | 'grading_criterion' | 'grading_question' | 'syllabus_coverage'
  item_ref       TEXT,            -- criterion name / coverage item code, for display + aggregation
  claim_text     TEXT NOT NULL,   -- the feedback text being challenged
  claim_quote    TEXT,            -- the citation the original claim carried, if any
  objection      TEXT NOT NULL,   -- teacher's free-text explanation of what's wrong
  verdict        TEXT NOT NULL,   -- 'confirm' | 'clarify' | 'retract'
  explanation    TEXT NOT NULL,
  evidence_quote TEXT,            -- fresh verbatim quote backing the verdict (validated server-side)
  suggested_text TEXT,            -- rewritten bullet/finding text when verdict != 'confirm'
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_feedback_challenges_teacher    ON feedback_challenges(teacher_id);
CREATE INDEX IF NOT EXISTS idx_feedback_challenges_assignment ON feedback_challenges(assignment_id) WHERE assignment_id IS NOT NULL;
