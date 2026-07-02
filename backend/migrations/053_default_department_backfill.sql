-- 053 — place institutional teachers without a primary unit into their
-- institution's default department.
--
-- Migration 047 backfilled teachers who existed at the time, but every member
-- who joined SINCE (invite, email-domain auto-join, SAML JIT) landed with
-- primary_org_unit_id = NULL — invisible in leadership dashboards and
-- structure headcounts. The registration/JIT/admin-move paths now assign the
-- default kafedra on join (assignDefaultDepartmentIfUnset); this heals the
-- rows created in between. Preference matches the code: the seeded
-- «Кафедра (по умолчанию)» first, else the institution's oldest department.
-- Idempotent — only touches NULL rows.

WITH pick AS (
  SELECT DISTINCT ON (institution_id) institution_id, id
    FROM org_units
   WHERE type_code = 'department'
   ORDER BY institution_id, (name = 'Кафедра (по умолчанию)') DESC, created_at ASC
)
UPDATE teachers t
   SET primary_org_unit_id = pick.id
  FROM pick
 WHERE t.institution_id = pick.institution_id
   AND t.primary_org_unit_id IS NULL;
