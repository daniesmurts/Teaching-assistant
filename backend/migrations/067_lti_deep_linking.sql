-- Migration 067 — LTI 1.3 Deep Linking session store (TODO item R, milestone
-- "Deep Linking + student launch").
--
-- A deep-linking request arrives as a POST to the same /api/lti/launch
-- endpoint as a regular launch, but the teacher then needs an interactive
-- frontend page to pick/create a published assignment before we can build
-- and POST back the signed LtiDeepLinkingResponse — that round trip can't
-- happen inside the original POST handler. This table bridges the two: the
-- launch handler stashes what it needs to build the response later, hands
-- the teacher a short-lived session id, and the picker page consumes it
-- once the teacher has made a selection. Short-lived and single-use, same
-- pattern as lti_launch_states.

CREATE TABLE IF NOT EXISTS lti_deep_link_sessions (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id         UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  teacher_id             UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  deployment_id          TEXT NOT NULL,
  context_id             TEXT,
  context_title          TEXT,
  course_id              UUID REFERENCES courses(id) ON DELETE SET NULL,
  deep_link_return_url   TEXT NOT NULL,
  passthrough_data        TEXT,             -- echoed back verbatim in the response per spec
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lti_deep_link_sessions_created_idx ON lti_deep_link_sessions (created_at);
