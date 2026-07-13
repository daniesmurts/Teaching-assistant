-- Deferred email verification (2026-07-12 audit follow-up). NULL = unverified.
-- Signup is NOT gated on this — the teacher gets in immediately and verifies
-- from a link in the welcome email. The flag is enforced only where an
-- unverified address causes real harm:
--   * SSO/LTI JIT linking to an existing password account (account
--     pre-hijack window — see findOrCreateSamlTeacher/findOrCreateLtiTeacher)
--   * marketing merge-list export (deliverability)
--   * activation nudge sweep (deliverability)
-- Security emails (password reset, payment) send regardless — they prove
-- address ownership by themselves.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;

-- Grandfather every existing account: they predate the feature, and SSO/LTI
-- provisioned rows had their email attested by the IdP already.
UPDATE teachers SET email_verified_at = created_at WHERE email_verified_at IS NULL;
