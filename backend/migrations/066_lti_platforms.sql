-- Migration 066 — LTI 1.3 + Advantage tool-provider support (TODO item R,
-- Research.md §6). Modeled directly on the SAML SSO schema (migration 041):
-- per-institution external-IdP-style config, JIT-provisioning fields on
-- teachers, and additive columns elsewhere so the existing tokenised student
-- rail (assignment_invites.token) and password/SAML rails are untouched.

-- ─── Per-institution LTI platform registration ────────────────────────────────
-- Mirrors institutions.saml_* — one registered platform (Moodle, etc.) per
-- institution. deployment_ids is a JSON array because Moodle can issue
-- several "External tool" activations under one client_id/issuer.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS lti_enabled                BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS lti_platform_issuer         TEXT,
  ADD COLUMN IF NOT EXISTS lti_platform_client_id      TEXT,
  ADD COLUMN IF NOT EXISTS lti_platform_deployment_ids JSONB NOT NULL DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS lti_platform_auth_login_url TEXT,  -- OIDC third-party-init endpoint
  ADD COLUMN IF NOT EXISTS lti_platform_auth_token_url TEXT,  -- client_credentials grant, for AGS/NRPS
  ADD COLUMN IF NOT EXISTS lti_platform_jwks_url       TEXT;  -- platform's public keys (fetched + cached)

CREATE INDEX IF NOT EXISTS institutions_lti_issuer_idx
  ON institutions (lti_platform_issuer) WHERE lti_platform_issuer IS NOT NULL;

-- ─── Teacher-side JIT provisioning (mirrors teachers.saml_subject) ────────────

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS lti_subject        TEXT,
  ADD COLUMN IF NOT EXISTS lti_provisioned_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS teachers_lti_subject_idx
  ON teachers (lti_subject) WHERE lti_subject IS NOT NULL;

-- ─── OIDC login-init replay defense ────────────────────────────────────────────
-- LTI 1.3's third-party-initiated login requires a state+nonce roundtrip that
-- SAML's AuthnRequest/Response pairing doesn't need in the same way. Rows are
-- single-use (deleted on launch) and short-lived (swept lazily on next
-- login-init call — see services/lti.ts).

CREATE TABLE IF NOT EXISTS lti_launch_states (
  state           TEXT PRIMARY KEY,
  nonce           TEXT NOT NULL,
  institution_id  UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  target_link_uri TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lti_launch_states_created_idx ON lti_launch_states (created_at);

-- ─── Launch-time course context resolution ────────────────────────────────────
-- Fast lookup keyed by what actually arrives in the launch JWT (deployment_id
-- + context claim). Distinct from org_units.external_code (migration 045),
-- which is the admin-facing mapping target for institutional reporting
-- rollups — that mapping happens later and non-blockingly; it never gates
-- whether a teacher can grade.

CREATE TABLE IF NOT EXISTS lti_course_links (
  id                            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id                UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  deployment_id                 TEXT NOT NULL,
  context_id                    TEXT NOT NULL,
  context_title                 TEXT,
  context_label                 TEXT,
  lis_course_section_sourcedid  TEXT,
  org_unit_id                   UUID REFERENCES org_units(id) ON DELETE SET NULL,
  course_id                     UUID REFERENCES courses(id) ON DELETE SET NULL,
  first_seen_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_launch_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (institution_id, deployment_id, context_id)
);

CREATE INDEX IF NOT EXISTS lti_course_links_unmapped_idx
  ON lti_course_links (institution_id) WHERE org_unit_id IS NULL;

-- ─── AGS grade write-back bookkeeping ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lti_line_items (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lti_course_link_id       UUID NOT NULL REFERENCES lti_course_links(id) ON DELETE CASCADE,
  lineitem_url             TEXT NOT NULL,
  published_assignment_id  UUID REFERENCES published_assignments(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE assignments
  ADD COLUMN IF NOT EXISTS lti_gradebook_synced_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lti_gradebook_sync_error TEXT;

-- ─── Second identity rail on assignment_invites (Deep Linking / student launch) ─
-- Additive and nullable — the existing tokenised rail (token, student_email
-- manual entry) is completely untouched. An LTI-launched student still gets
-- a normal `token` minted server-side, so /student/:token on the frontend
-- needs zero changes; LTI only changes how the invite is created and how the
-- student arrives at that URL.

ALTER TABLE assignment_invites
  ADD COLUMN IF NOT EXISTS lti_subject       TEXT,
  ADD COLUMN IF NOT EXISTS lti_deployment_id TEXT,
  ADD COLUMN IF NOT EXISTS lti_context_id    TEXT;

CREATE INDEX IF NOT EXISTS assignment_invites_lti_subject_idx
  ON assignment_invites (lti_subject) WHERE lti_subject IS NOT NULL;
