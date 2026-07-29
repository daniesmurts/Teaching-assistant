-- Migration 101 — «Материально-техническое обеспечение» (РПД §12) check,
-- requested by the УМЦ head: catch a §12 that lists only generic classroom
-- items (мел, доска, парта) instead of the actual licensed software/
-- equipment a discipline needs, and cross-check named tools mentioned in
-- лабораторные/практические content against what §12 declares.
--
-- Phase 1 only — no licensed-software registry. The real "проверка по базе
-- программного лицензионного обеспечения" the УМЦ head asked for needs the
-- university's own procurement/IT licence list, which doesn't exist inside
-- ИСПУМ; that's a separate, larger feature (an institution-maintained
-- registry) gated on whether that data can actually be supplied. This
-- migration only adds the AI-only check that needs no such registry.
--
-- Mirrors program_placement_reviews (migration 100) exactly — one row per
-- run, latest per discipline_id read by the UI.
CREATE TABLE IF NOT EXISTS program_mto_reviews (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id     UUID NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  discipline_id  UUID NOT NULL REFERENCES program_disciplines(id) ON DELETE CASCADE,
  document_id    UUID NOT NULL REFERENCES program_documents(id) ON DELETE CASCADE,
  result         JSONB NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS program_mto_reviews_program_idx
  ON program_mto_reviews (program_id, created_at DESC);
CREATE INDEX IF NOT EXISTS program_mto_reviews_discipline_idx
  ON program_mto_reviews (discipline_id, created_at DESC);
