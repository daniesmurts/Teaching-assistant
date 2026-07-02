-- 055 — programme metadata on org units.
--
-- The IT/УМЦ admin already builds the org tree and names each program /
-- program_direction unit (often «15.03.02 …»). Letting them also record the
-- standardised ФГОС header data on that unit means a РОП importing their
-- programme picks the unit and the code / направление / уровень / формы
-- auto-fill instead of being retyped (and mistyped) every time. Fields are
-- meaningful only for `program` / `program_direction` units; NULL elsewhere.
-- Shapes mirror the `programs` table columns they prefill.

ALTER TABLE org_units
  ADD COLUMN IF NOT EXISTS code            TEXT,
  ADD COLUMN IF NOT EXISTS specialty_name  TEXT,
  ADD COLUMN IF NOT EXISTS education_level TEXT,
  ADD COLUMN IF NOT EXISTS forms_of_study  TEXT;
