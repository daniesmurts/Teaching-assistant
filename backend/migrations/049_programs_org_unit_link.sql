-- Migration 049 — Link academic programs to their slot in the §7 org tree.
--
-- Until now the `programs` table was scoped only by institution_id. The org
-- tree carries a separate `org_units` row per academic programme (type_code =
-- 'program'). Role-based access for an РОП (head on the program unit) needs an
-- explicit link between the two — without it, "see only programs you head"
-- can't be answered cheaply.
--
-- Nullable on purpose: existing programs predate the link and arrive as NULL.
-- The IT admin sets the link via the program edit form (a single «Подразделение
-- в структуре» select). РОП scoping requires the link to be set.
-- ON DELETE SET NULL — if the IT admin deletes the org_unit, the program row
-- survives (still institution-scoped) and the link can be re-set later.

ALTER TABLE programs
  ADD COLUMN IF NOT EXISTS org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS programs_org_unit_idx ON programs (org_unit_id);
