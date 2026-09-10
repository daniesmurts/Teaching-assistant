-- Micro-satisfaction prompts (TODO Feature SAT, Phase 0).
--
-- ONE table, not the prompts/responses pair the design sketch proposed. The
-- unit worth recording is the *prompt*, not the answer: a prompt that was
-- shown and ignored is the single most important row in here, because the
-- dismissal rate is what decides whether this mechanism survives at all. Two
-- tables would have made "shown but never answered" a LEFT JOIN and an
-- absence, which is exactly the shape of fact that quietly stops being
-- checked. Here it's `responded_at IS NULL AND dismissed_at IS NULL`.
--
-- The row is created when the prompt is SHOWN, which is also what advances the
-- throttle. Advancing on answer instead would re-ask every teacher who
-- dismisses, i.e. exactly the people who already told us to stop.
CREATE TABLE IF NOT EXISTS satisfaction_prompts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- CASCADE, deliberately: a teacher deleting their account deletes their
  -- ratings with it, matching the caskade-delete promise in
  -- docs/legal/security-overview.md §6. The cost is that per-institution
  -- history shifts when someone leaves — accepted, because the alternative is
  -- retaining a named person's opinions after they asked us not to.
  teacher_id     UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,

  -- Denormalised so the Phase 3 per-institution rollup doesn't depend on the
  -- teacher's CURRENT institution — a teacher who moves shouldn't retroactively
  -- move their past ratings to the new employer's satisfaction score.
  institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,

  -- 'grading' only in Phase 1. Free text rather than an enum so adding a
  -- feature is a code change, not a migration (the values are ours, not
  -- user input).
  feature        TEXT NOT NULL,

  -- The specific artefact rated, when there is one. This is the whole point of
  -- rating an artefact instead of a "session": it makes the score joinable to
  -- what actually happened — api_usage_log's model/provider/tokens, the
  -- confidence ensemble's own score for that grade. NULL is allowed for
  -- features with no single object.
  artifact_id    UUID,

  -- 1 = плохо, 2 = нормально, 3 = хорошо. NULL until answered.
  score          SMALLINT CHECK (score IS NULL OR score BETWEEN 1 AND 3),
  comment        TEXT,

  -- Snapshot of the conditions being rated (model, provider, confidence…).
  -- Copied at prompt time rather than joined later: the assignment row can be
  -- re-graded, and then the join would describe a different artefact than the
  -- one the teacher actually saw.
  context        JSONB NOT NULL DEFAULT '{}'::JSONB,

  shown_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at   TIMESTAMPTZ,
  dismissed_at   TIMESTAMPTZ
);

-- The throttle read: "when did we last bother this teacher, about anything".
CREATE INDEX IF NOT EXISTS satisfaction_prompts_teacher_idx
  ON satisfaction_prompts (teacher_id, shown_at DESC);

-- The rollup read: per-feature scores over a window, and the dismissal rate.
CREATE INDEX IF NOT EXISTS satisfaction_prompts_feature_idx
  ON satisfaction_prompts (feature, shown_at DESC);
