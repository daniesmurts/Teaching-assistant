-- 057 — per-semester ЗЕТ totals as reported by the учебный план itself.
--
-- parseStudyPlan now extracts the plan's own «Итого/Всего за семестр N: X з.е.»
-- rows in addition to the discipline list. deriveLoadCheck reconciles the sum
-- of extracted discipline credits per semester against these plan-asserted
-- totals — a mismatch is a direct signal of a truncated or mis-parsed
-- extraction (which today shows up only as an off-target load chart with no
-- root-cause explanation).
--
-- JSONB shape: { "1": 30, "2": 30, ... }  (semester → credits).
-- Nullable — legacy programmes and imports without an Итого section have no
-- totals to reconcile against; deriveLoadCheck simply skips reconciliation.

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS reported_semester_totals JSONB;
