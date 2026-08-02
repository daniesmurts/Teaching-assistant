-- Migration 111 — institutional pricing-calculator assumptions (internal
-- platform-admin tool, negotiation modeling only — see TODO.md/CHANGELOG for
-- the AdminPricing page this backs).
--
-- One row per institution, keyed on institution_id; institution_id IS NULL
-- is the single "global defaults" row used when no institution is selected
-- (prospective-deal mode, or before any institution-specific override has
-- been saved). Two partial unique indexes because a plain UNIQUE(institution_id)
-- would let Postgres accept unlimited NULL rows (NULLs are never equal to each
-- other in a unique constraint) — the second index closes that gap by
-- indexing a constant expression, so only one NULL row can ever exist.
--
-- Additive only — no existing table touched.

CREATE TABLE IF NOT EXISTS pricing_assumptions (
  id                                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id                              UUID REFERENCES institutions(id) ON DELETE CASCADE,
  activation_override                         NUMERIC(5,2),   -- 0–100, % — manual override (prospective institutions have no usage history to derive this from)
  margin_multiplier                           NUMERIC(5,2) NOT NULL DEFAULT 3.5,
  max_discount_pct                            NUMERIC(5,2) NOT NULL DEFAULT 55,
  cost_per_active_teacher_manual_override_rub NUMERIC(10,2),  -- infra cost has no per-teacher granularity in the DB; NULL = not overridden
  updated_by                                  UUID REFERENCES teachers(id),
  updated_at                                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS pricing_assumptions_institution_uidx
  ON pricing_assumptions (institution_id) WHERE institution_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS pricing_assumptions_global_uidx
  ON pricing_assumptions ((1)) WHERE institution_id IS NULL;
