-- Feature R backlog item #1: a persistent launch activity log for
-- InstitutionLti.tsx's institution-admin troubleshooting view. Distinct from
-- lti_launch_states (066) — that table is ephemeral (single-use, deleted on
-- consumption, TTL-swept) and exists purely for OIDC state/nonce replay
-- protection, not for a durable "what happened" record.

CREATE TABLE IF NOT EXISTS lti_launch_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  -- NULL when the launch failed before a teacher could be resolved (bad
  -- token, unknown deployment, etc.) — still worth a row for troubleshooting.
  teacher_id     UUID REFERENCES teachers(id) ON DELETE SET NULL,
  message_type   TEXT,
  role           TEXT,              -- 'instructor' | 'learner' | NULL (unresolved)
  context_title  TEXT,
  success        BOOLEAN NOT NULL,
  error_code     TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lti_launch_log_institution_idx
  ON lti_launch_log (institution_id, created_at DESC);
