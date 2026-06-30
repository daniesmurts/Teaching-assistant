-- Migration 047 — Heal institutions missing an org-tree root.
--
-- Migration 045 backfilled a root `institution` org_unit + a default
-- `department` for every institution that existed when it ran. But
-- `createInstitution()` (POST /api/admin/institutions) was not updated to seed
-- the same tree, so any institution created between 045 and the
-- createInstitution patch ships with zero org_units. The structure page then
-- shows "Корневое подразделение не найдено" because /api/institution/structure
-- returns an empty array.
--
-- This re-runs the same guarded backfill from 045 §Backfill steps 1–3. It is
-- idempotent — institutions already healed are skipped by the NOT EXISTS guards.
-- It does NOT touch teacher roles or the platform_admin flag (those were
-- one-shot in 045 and are not part of the bug).

-- 1. One root `institution` unit per institution that doesn't have one yet.
INSERT INTO org_units (institution_id, parent_id, type_code, name, path)
SELECT i.id, NULL, 'institution', i.name, ''
  FROM institutions i
 WHERE NOT EXISTS (
   SELECT 1 FROM org_units r
    WHERE r.institution_id = i.id AND r.type_code = 'institution' AND r.parent_id IS NULL
 );

UPDATE org_units
   SET path = '/' || id::text || '/'
 WHERE type_code = 'institution' AND parent_id IS NULL AND (path = '' OR path IS NULL);

-- 2. A placeholder `department` under each root that doesn't have any child
--    department yet. Admins reshape the tree afterwards in the UI.
INSERT INTO org_units (institution_id, parent_id, type_code, name, path)
SELECT r.institution_id, r.id, 'department', 'Кафедра (по умолчанию)', ''
  FROM org_units r
 WHERE r.type_code = 'institution' AND r.parent_id IS NULL
   AND NOT EXISTS (
     SELECT 1 FROM org_units d WHERE d.parent_id = r.id AND d.type_code = 'department'
   );

UPDATE org_units d
   SET path = r.path || d.id::text || '/'
  FROM org_units r
 WHERE d.parent_id = r.id AND d.type_code = 'department' AND (d.path = '' OR d.path IS NULL);

-- 3. Attach any institutional teacher without a primary unit to their
--    institution's placeholder department. Covers teachers who registered via
--    invite/domain-join into an institution that had no tree.
UPDATE teachers t
   SET primary_org_unit_id = d.id
  FROM org_units d
  JOIN org_units r ON r.id = d.parent_id AND r.type_code = 'institution' AND r.parent_id IS NULL
 WHERE d.type_code = 'department'
   AND r.institution_id = t.institution_id
   AND t.institution_id IS NOT NULL
   AND t.primary_org_unit_id IS NULL;
