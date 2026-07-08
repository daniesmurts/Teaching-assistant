-- Migration 068 — LTI 1.3 NRPS roster sync + Dynamic Registration (TODO item
-- R, remaining backlog).

-- ─── NRPS membership URL, captured at instructor launch ───────────────────────
-- The `https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice` claim
-- carries the context_memberships_url — captured once per course link, same
-- opportunistic-capture pattern as the AGS lineitem URL on lti_line_items.

ALTER TABLE lti_course_links
  ADD COLUMN IF NOT EXISTS nrps_context_memberships_url TEXT;

-- ─── Dynamic Registration session store ────────────────────────────────────────
-- Mirrors lti_launch_states: a short-lived, single-use row bridging "admin
-- clicks a button in our UI" and "Moodle's registration screen navigates to
-- our registration endpoint appending its own openid_configuration and
-- registration_token query params." There is no institution_id in what
-- Moodle sends us, so this session is how we recover it.

CREATE TABLE IF NOT EXISTS lti_registration_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lti_registration_sessions_created_idx ON lti_registration_sessions (created_at);
