-- Migration 085 — Per-institution allowlist for "upload document by URL".
--
-- The URL-fetch feature (services/documentFetch.ts) originally derived its
-- allowlist from institutions.email_domain (the email auto-join domain) plus
-- an env var. That overloaded the auto-join field with a second meaning and
-- had no self-serve control — an institution admin couldn't manage it. This
-- gives the allowlist its own column, editable by the institution admin from
-- the org overview page. email_domain goes back to meaning only auto-join.
--
-- Bare hostnames (e.g. 'kstu.ru'); a subdomain of a listed host is allowed
-- too (kstu.ru covers www.kstu.ru). Normalisation/validation happens in the
-- route before write.

ALTER TABLE institutions
  ADD COLUMN IF NOT EXISTS document_fetch_domains TEXT[] NOT NULL DEFAULT '{}';
