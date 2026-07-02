-- 052 — clear org-tree ties that point outside a teacher's current institution.
--
-- When a platform admin reassigned a teacher between institutions, the PATCH
-- never cleaned up `org_unit_roles` rows or `primary_org_unit_id` pointing at
-- the OLD institution's units. Those stale rows kept granting the moved
-- teacher leadership visibility into the old org, and kept them drillable by
-- the old org's heads. The route now clears ties on every move
-- (clearOrgTiesOutsideInstitution); this migration heals rows that went stale
-- before the fix. Idempotent — re-running deletes nothing new.

-- Roles on units belonging to a different institution than the teacher's
-- current one (or any institution, if the teacher is unattached).
DELETE FROM org_unit_roles our
 USING org_units u, teachers t
 WHERE u.id = our.org_unit_id
   AND t.id = our.teacher_id
   AND (t.institution_id IS NULL OR t.institution_id <> u.institution_id);

-- Primary departments pointing into a foreign institution's tree.
UPDATE teachers t
   SET primary_org_unit_id = NULL
  FROM org_units u
 WHERE u.id = t.primary_org_unit_id
   AND (t.institution_id IS NULL OR t.institution_id <> u.institution_id);
