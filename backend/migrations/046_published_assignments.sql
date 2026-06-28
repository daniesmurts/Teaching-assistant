-- Migration 046 — Published assignments + process-of-creation attestation
-- (Research.md §5.1, Feature Q1).
--
-- Inverts the existing flow: a teacher publishes an assignment DEFINITION;
-- students write against it in-platform via per-student tokenised links (no
-- accounts); on submit the work flows into the existing `assignments` table for
-- grading. Three tables keep the student writing workspace OUT of the core
-- grading/RAG/history flows until a submission actually exists.
--
-- 152-FZ: submission_telemetry stores DERIVED AGGREGATES ONLY (paste-event
-- sizes, active minutes, revision counts) — never the raw keystroke stream.

-- ─── Definition: what the teacher publishes ───────────────────────────────────

CREATE TABLE IF NOT EXISTS published_assignments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  course_id     UUID REFERENCES courses(id) ON DELETE SET NULL,
  rubric_id     UUID REFERENCES rubrics(id) ON DELETE SET NULL,
  title         TEXT NOT NULL,
  instructions  TEXT,                              -- the prompt students see
  due_at        TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'draft',     -- 'draft' | 'open' | 'closed'
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS published_assignments_teacher_idx
  ON published_assignments (teacher_id, created_at DESC);

-- ─── Per-student writing workspace (one row per invited student) ──────────────

CREATE TABLE IF NOT EXISTS assignment_invites (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  published_assignment_id UUID NOT NULL REFERENCES published_assignments(id) ON DELETE CASCADE,
  student_name            TEXT,
  student_email           TEXT,
  token                   TEXT NOT NULL UNIQUE,    -- secure random; the link credential
  status                  TEXT NOT NULL DEFAULT 'invited',  -- 'invited' | 'writing' | 'submitted'
  draft_content           JSONB,                   -- live TipTap document (autosave/resume)
  submission_telemetry    JSONB,                   -- DERIVED AGGREGATES ONLY (§5.1.2)
  consent_accepted_at     TIMESTAMPTZ,
  consent_version         TEXT,
  assignment_id           UUID REFERENCES assignments(id) ON DELETE SET NULL,  -- set on submit
  submitted_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assignment_invites_pub_idx ON assignment_invites (published_assignment_id);
CREATE INDEX IF NOT EXISTS assignment_invites_token_idx ON assignment_invites (token);

-- ─── Draft snapshots for §5.3 longitudinal trajectory ─────────────────────────

CREATE TABLE IF NOT EXISTS submission_snapshots (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id   UUID NOT NULL REFERENCES assignment_invites(id) ON DELETE CASCADE,
  seq         INTEGER NOT NULL,
  content     JSONB,
  char_count  INTEGER,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (invite_id, seq)
);

CREATE INDEX IF NOT EXISTS submission_snapshots_invite_idx ON submission_snapshots (invite_id, seq);

-- ─── Link a graded submission back to its published assignment + provenance ───
-- Additive: existing direct-grading rows keep NULLs and behave exactly as before.

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS published_assignment_id UUID REFERENCES published_assignments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_telemetry    JSONB,
  ADD COLUMN IF NOT EXISTS submitted_at            TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS assignments_published_idx
  ON assignments (published_assignment_id) WHERE published_assignment_id IS NOT NULL;
