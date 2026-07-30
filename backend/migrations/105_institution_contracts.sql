-- Migration 105 — TODO.md Feature AL, Phase 0. Institution revenue does not
-- exist anywhere in the database today: `payments` is teacher-scoped
-- (`teacher_id NOT NULL`, plans 'pro_monthly'|'pro_annual' only), and
-- `institutions` has just name/plan_tier/max_teachers (a licensing cap, not
-- a price). Institution deals are negotiated offline via 44-ФЗ procurement,
-- so a manual record is the correct model here, not a payment integration —
-- margin can't be computed from revenue that was never recorded anywhere.
--
-- One row per contract term (not one row per institution) — an institution
-- can have a history of renewed/renegotiated contracts, and Phase 1's
-- amortization needs to know which term a given month falls under.

CREATE TABLE IF NOT EXISTS institution_contracts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id   UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  annual_value_rub NUMERIC(14,2) NOT NULL CHECK (annual_value_rub >= 0),
  seats_purchased  INTEGER NOT NULL CHECK (seats_purchased > 0),
  term_start       DATE NOT NULL,
  term_end         DATE NOT NULL CHECK (term_end > term_start),
  notes            TEXT,
  created_by       UUID REFERENCES teachers(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS institution_contracts_institution_idx
  ON institution_contracts (institution_id, term_start DESC);
