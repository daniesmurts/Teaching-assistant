-- Migration 045 — Organisational structure model (Research.md §7, Feature P).
--
-- Replaces the flat `institutions` + 3-value `teachers.role` enum scoping with a
-- canonical-typed, flexible-depth org tree. Each institution is the root of a
-- tree of org_units typed by:
--   institution | governance | admin_office | cluster | division | department
-- Teachers belong to one `department` via teachers.primary_org_unit_id. Roles
-- are scoped per unit via org_unit_roles(teacher_id, org_unit_id, role) where
-- role ∈ {admin, head, viewer}. Authorisation walks the materialised `path`: a
-- role on any ancestor unit grants that role on all descendants.
--
-- platform_admin stays ORTHOGONAL to the tree — a flat boolean flag on the
-- teacher that short-circuits every unit-scope check.
--
-- This migration is ADDITIVE: teachers.role is retained (deprecated, not
-- dropped) so the legacy requireRole middleware keeps working until every admin
-- route is migrated to the unit-scoped authoriser. Do not drop teachers.role in
-- this migration.

-- ─── Tables ───────────────────────────────────────────────────────────────────

-- Canonical org-unit tree (one tree per institution). `path` is a materialised
-- path of unit ids, e.g. '/inst-uuid/admin-uuid/dept-uuid/', enabling O(log n)
-- subtree + ancestor queries without recursive CTEs on the hot path.
CREATE TABLE IF NOT EXISTS org_units (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  institution_id  UUID NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  parent_id       UUID REFERENCES org_units(id) ON DELETE CASCADE,
  type_code       TEXT NOT NULL,        -- 'institution'|'governance'|'admin_office'|'cluster'|'division'|'department'
  name            TEXT NOT NULL,        -- full Russian name
  short_name      TEXT,                 -- УМЦ, ОАиД, etc.
  external_code   TEXT,                 -- LMS / LTI / AD mapping key (Feature R)
  path            TEXT NOT NULL,        -- materialised path, see above
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (institution_id, parent_id, name)
);

CREATE INDEX IF NOT EXISTS org_units_institution_idx     ON org_units (institution_id);
CREATE INDEX IF NOT EXISTS org_units_parent_idx          ON org_units (parent_id);
CREATE INDEX IF NOT EXISTS org_units_path_idx            ON org_units (path text_pattern_ops);
CREATE INDEX IF NOT EXISTS org_units_inst_type_idx       ON org_units (institution_id, type_code);

-- Unit-scoped roles. A teacher may hold multiple rows (kafedra head who is also
-- a teacher; deputy УМЦ head who also heads one cluster).
CREATE TABLE IF NOT EXISTS org_unit_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id    UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  org_unit_id   UUID NOT NULL REFERENCES org_units(id) ON DELETE CASCADE,
  role          TEXT NOT NULL,          -- 'admin' | 'head' | 'viewer'
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (teacher_id, org_unit_id, role)
);

CREATE INDEX IF NOT EXISTS org_unit_roles_teacher_idx ON org_unit_roles (teacher_id);
CREATE INDEX IF NOT EXISTS org_unit_roles_unit_idx    ON org_unit_roles (org_unit_id);

-- ─── Teacher columns ──────────────────────────────────────────────────────────

-- Teachers point at their primary department (kafedra). NULL for individual
-- (non-institutional) teachers — the tree is per-institution.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS primary_org_unit_id UUID REFERENCES org_units(id) ON DELETE SET NULL;

-- Orthogonal platform-owner flag — short-circuits unit-scope checks. Kept
-- separate from the tree because the platform owner is not part of any
-- institution's structure.
ALTER TABLE teachers
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- ─── Backfill ─────────────────────────────────────────────────────────────────
-- All backfill steps are guarded so a half-applied + manually re-run migration
-- does not double-create. Individual (no-institution) teachers are untouched.

-- 1. One root `institution` unit per existing institution.
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

-- 2. A placeholder `department` under each root; all the institution's teachers
--    will be assigned to it. Admins re-organise the tree afterwards in the UI.
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

-- 3. Assign every institutional teacher to their institution's placeholder dept.
UPDATE teachers t
   SET primary_org_unit_id = d.id
  FROM org_units d
  JOIN org_units r ON r.id = d.parent_id AND r.type_code = 'institution' AND r.parent_id IS NULL
 WHERE d.type_code = 'department'
   AND r.institution_id = t.institution_id
   AND t.institution_id IS NOT NULL
   AND t.primary_org_unit_id IS NULL;

-- 4. Existing institution_admin → admin on the institution root unit.
INSERT INTO org_unit_roles (teacher_id, org_unit_id, role)
SELECT t.id, r.id, 'admin'
  FROM teachers t
  JOIN org_units r ON r.institution_id = t.institution_id
                  AND r.type_code = 'institution' AND r.parent_id IS NULL
 WHERE t.role = 'institution_admin' AND t.institution_id IS NOT NULL
ON CONFLICT (teacher_id, org_unit_id, role) DO NOTHING;

-- 5. Existing platform_admin → orthogonal flag.
UPDATE teachers SET is_platform_admin = TRUE
 WHERE role = 'platform_admin' AND is_platform_admin = FALSE;
