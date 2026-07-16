-- Migration 079 — share rubrics/criteria to a specific org unit, not just
-- "whole institution".
--
-- Background: is_institution_shared is all-or-nothing. Teachers asked to
-- share within their own department without exposing drafts to the entire
-- university. shared_unit_id points at the org_units row the rubric/criterion
-- is shared with; visibility follows the tree (a teacher whose primary unit
-- sits at-or-under shared_unit_id can see it — same ancestor-or-self rule
-- requireUnitRole already uses via org_units.path prefix matching).
--
-- is_institution_shared is kept in sync as a legacy mirror (TRUE whenever
-- shared_unit_id points at the institution root) so any code still reading
-- the flag keeps working; new reads should prefer shared_unit_id.

ALTER TABLE rubrics
  ADD COLUMN IF NOT EXISTS shared_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;

ALTER TABLE criteria
  ADD COLUMN IF NOT EXISTS shared_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS rubrics_shared_unit_idx ON rubrics (shared_unit_id);
CREATE INDEX IF NOT EXISTS criteria_shared_unit_idx ON criteria (shared_unit_id);

-- Backfill: existing institution-shared rows point at their author's
-- institution root unit.
UPDATE rubrics r
   SET shared_unit_id = root.id
  FROM teachers t
  JOIN org_units root
    ON root.institution_id = t.institution_id
   AND root.type_code = 'institution'
   AND root.parent_id IS NULL
 WHERE r.teacher_id = t.id
   AND r.is_institution_shared = TRUE
   AND r.shared_unit_id IS NULL;

UPDATE criteria c
   SET shared_unit_id = root.id
  FROM teachers t
  JOIN org_units root
    ON root.institution_id = t.institution_id
   AND root.type_code = 'institution'
   AND root.parent_id IS NULL
 WHERE c.teacher_id = t.id
   AND c.is_institution_shared = TRUE
   AND c.shared_unit_id IS NULL;
