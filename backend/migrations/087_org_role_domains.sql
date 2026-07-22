-- Research.md §7.10 — domain-scoped grants, Phase 1.
--
-- A unit-role grant becomes (level) x (domain) x (unit subtree) instead of
-- just (level) x (subtree). `domain` defaults to 'all', which the resolver
-- (services/accessScope.ts) expands across every concrete domain — so every
-- existing grant (all of them 'admin' on the institution root, from the
-- original backfill) keeps its current effective access unchanged.
--
-- Rides along in this migration (Research.md §7.10.3, decided 2026-07-22):
-- role values rename 'head' -> 'edit', 'viewer' -> 'view'. "Head" was a job
-- title, not a permission level -- in the two-axis model the same level is
-- held by functional staff (УМЦ head, ПР УР) who don't "head" any unit.

ALTER TABLE org_unit_roles ADD COLUMN IF NOT EXISTS domain TEXT NOT NULL DEFAULT 'all';

UPDATE org_unit_roles SET role = 'edit' WHERE role = 'head';
UPDATE org_unit_roles SET role = 'view' WHERE role = 'viewer';

ALTER TABLE org_unit_roles DROP CONSTRAINT IF EXISTS org_unit_roles_teacher_id_org_unit_id_role_key;
ALTER TABLE org_unit_roles ADD CONSTRAINT org_unit_roles_teacher_unit_role_domain_key
  UNIQUE (teacher_id, org_unit_id, role, domain);
