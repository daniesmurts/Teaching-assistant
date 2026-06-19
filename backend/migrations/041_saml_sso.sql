-- Migration 041 — SAML 2.0 SSO (per-institution).
--
-- Each institution that wants SSO supplies its IdP metadata (entity id, SSO
-- URL, signing cert). Our SP entity id and keypair are global, kept in env
-- vars — not per-institution.
--
-- Email-domain discovery: a teacher types their email on the login page; if
-- institutions.email_domain matches and saml_enabled = TRUE, we redirect
-- them to that institution's IdP. Password auth keeps working for everyone
-- unless saml_force_sso is later set TRUE (deferred — UI not exposed in v1).
--
-- Provisioning is just-in-time. First successful SAML assertion creates the
-- teacher row, attaches the institution_id, stores the IdP NameID
-- (saml_subject) for audit, and stamps saml_provisioned_at.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS saml_enabled          BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS saml_idp_entity_id    TEXT,
  ADD COLUMN IF NOT EXISTS saml_idp_sso_url      TEXT,
  ADD COLUMN IF NOT EXISTS saml_idp_x509_cert    TEXT,
  ADD COLUMN IF NOT EXISTS saml_attribute_email  TEXT NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS saml_attribute_name   TEXT NOT NULL DEFAULT 'displayName',
  ADD COLUMN IF NOT EXISTS saml_force_sso        BOOLEAN NOT NULL DEFAULT FALSE;

-- A SAML config is "complete" only when all three IdP fields are populated.
-- We don't enforce this at the row level (an admin may save partial config
-- mid-edit), but the discover endpoint refuses to route until it's complete.

ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS saml_subject          TEXT,
  ADD COLUMN IF NOT EXISTS saml_provisioned_at   TIMESTAMPTZ;

-- Lookup: "is this email already attached to a SAML-provisioned teacher?"
-- Sparse — only set for SSO accounts — so a partial index keeps it tight.
CREATE INDEX IF NOT EXISTS teachers_saml_subject_idx
  ON teachers (saml_subject)
  WHERE saml_subject IS NOT NULL;
