import { pool } from '../connection'

// ─── Canonical taxonomy (Research.md §7.1) ────────────────────────────────────

export const ORG_UNIT_TYPES = [
  'institution',
  'governance',
  'admin_office',
  'cluster',     // displayed as «Полигруппа» — renamed from «Кластер направлений»
  'division',
  'program',     // «Образовательная программа» — РОП is `head` on this unit
  'department',
] as const
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number]

export const UNIT_ROLES = ['admin', 'head', 'viewer'] as const
export type UnitRole = (typeof UNIT_ROLES)[number]

// ─── Row shapes ───────────────────────────────────────────────────────────────

export interface OrgUnitRow {
  id:             string
  institution_id: string
  parent_id:      string | null
  type_code:      string
  name:           string
  short_name:     string | null
  external_code:  string | null
  path:           string
  created_at:     Date
}

export interface UnitRoleRow {
  id:          string
  teacher_id:  string
  org_unit_id: string
  role:        string
  created_at:  Date
}

/** A teacher's role rows joined to the unit `path` — enough to evaluate scope
 *  in memory without a second round trip. */
export interface TeacherRoleScope {
  org_unit_id: string
  role:        string
  path:        string
}

// ─── Reads ────────────────────────────────────────────────────────────────────

export async function getOrgUnitById(id: string): Promise<OrgUnitRow | null> {
  const { rows } = await pool.query<OrgUnitRow>(
    'SELECT * FROM org_units WHERE id = $1 LIMIT 1',
    [id]
  )
  return rows[0] ?? null
}

/** The whole tree for an institution, ordered by path so callers can render it
 *  hierarchically without re-sorting. */
export async function listOrgUnitsForInstitution(institutionId: string): Promise<OrgUnitRow[]> {
  const { rows } = await pool.query<OrgUnitRow>(
    'SELECT * FROM org_units WHERE institution_id = $1 ORDER BY path',
    [institutionId]
  )
  return rows
}

export interface OrgUnitWithCount extends OrgUnitRow {
  member_count: number   // teachers whose primary department sits in this subtree
}

/** The whole tree for an institution, each unit annotated with the number of
 *  teachers in its subtree (path-prefix match). Ordered by `created_at` so the
 *  frontend tree-builder renders siblings in the order the admin added them —
 *  `path` would sort siblings by their trailing UUID (random), which surfaces
 *  as 6-6 / 6-3 / 6-5 / … in the structure list. */
export async function listOrgUnitsWithCounts(institutionId: string): Promise<OrgUnitWithCount[]> {
  const { rows } = await pool.query<OrgUnitWithCount>(
    `SELECT u.*,
            (SELECT COUNT(*)::int
               FROM teachers t
               JOIN org_units pu ON pu.id = t.primary_org_unit_id
              WHERE pu.path LIKE u.path || '%') AS member_count
       FROM org_units u
      WHERE u.institution_id = $1
      ORDER BY u.created_at`,
    [institutionId]
  )
  return rows
}

/** Direct children + subtree member counts — used to block destructive deletes
 *  until the admin has moved everything out of a unit. */
export async function getOrgUnitDependents(unitId: string): Promise<{ children: number; members: number }> {
  const { rows } = await pool.query<{ children: string; members: string }>(
    `SELECT
       (SELECT COUNT(*) FROM org_units c WHERE c.parent_id = $1) AS children,
       (SELECT COUNT(*) FROM teachers t
          JOIN org_units pu ON pu.id = t.primary_org_unit_id
          JOIN org_units u  ON u.id = $1
         WHERE pu.path LIKE u.path || '%') AS members`,
    [unitId]
  )
  return { children: parseInt(rows[0].children, 10), members: parseInt(rows[0].members, 10) }
}

export async function getRootUnitForInstitution(institutionId: string): Promise<OrgUnitRow | null> {
  const { rows } = await pool.query<OrgUnitRow>(
    `SELECT * FROM org_units
      WHERE institution_id = $1 AND type_code = 'institution' AND parent_id IS NULL
      LIMIT 1`,
    [institutionId]
  )
  return rows[0] ?? null
}

/** All unit-roles a teacher holds, joined to each holder unit's path. The
 *  caller can answer many access questions from this single fetch. */
export async function listRoleScopesForTeacher(teacherId: string): Promise<TeacherRoleScope[]> {
  const { rows } = await pool.query<TeacherRoleScope>(
    `SELECT our.org_unit_id, our.role, u.path
       FROM org_unit_roles our
       JOIN org_units u ON u.id = our.org_unit_id
      WHERE our.teacher_id = $1`,
    [teacherId]
  )
  return rows
}

/**
 * Authoritative single-query access check: does `teacherId` hold any of
 * `roles` on `targetUnitId` or any of its ancestors? A holder unit is an
 * ancestor-or-self of the target when the holder's `path` is a prefix of the
 * target's `path` (paths are '/a/b/c/' so prefix-match is exact).
 */
export async function teacherCanActOnUnit(
  teacherId:    string,
  targetUnitId: string,
  roles:        readonly string[]
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM org_unit_roles our
         JOIN org_units holder ON holder.id = our.org_unit_id
         JOIN org_units target ON target.id = $2
        WHERE our.teacher_id = $1
          AND our.role = ANY($3::text[])
          AND target.path LIKE holder.path || '%'
     ) AS ok`,
    [teacherId, targetUnitId, roles as string[]]
  )
  return rows[0]?.ok ?? false
}

// ─── Writes ───────────────────────────────────────────────────────────────────

/** Create a unit, computing its materialised path from the parent atomically.
 *  Root units (no parent) are not created here — they come from the migration
 *  and from institution creation. */
export async function createOrgUnit(data: {
  institutionId: string
  parentId:      string
  typeCode:      OrgUnitType
  name:          string
  shortName?:    string | null
  externalCode?: string | null
}): Promise<OrgUnitRow> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const parent = await client.query<{ path: string; institution_id: string }>(
      'SELECT path, institution_id FROM org_units WHERE id = $1 FOR UPDATE',
      [data.parentId]
    )
    if (!parent.rows[0]) throw new Error('Parent org unit not found')
    if (parent.rows[0].institution_id !== data.institutionId) {
      throw new Error('Parent org unit belongs to a different institution')
    }

    const inserted = await client.query<OrgUnitRow>(
      `INSERT INTO org_units (institution_id, parent_id, type_code, name, short_name, external_code, path)
       VALUES ($1, $2, $3, $4, $5, $6, '')
       RETURNING *`,
      [data.institutionId, data.parentId, data.typeCode, data.name,
       data.shortName ?? null, data.externalCode ?? null]
    )
    const row = inserted.rows[0]

    const path = `${parent.rows[0].path}${row.id}/`
    const updated = await client.query<OrgUnitRow>(
      'UPDATE org_units SET path = $2 WHERE id = $1 RETURNING *',
      [row.id, path]
    )

    await client.query('COMMIT')
    return updated.rows[0]
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/** Create many sibling units under one parent, all of the same type, in a
 *  single transaction. Used by the paste-many bulk-add UI. Caller validates
 *  per-unit names; the DB UNIQUE (institution_id, parent_id, name) catches
 *  collisions both within the batch and against existing siblings. */
export async function bulkCreateOrgUnits(data: {
  institutionId: string
  parentId:      string
  typeCode:      OrgUnitType
  units:         { name: string; shortName?: string | null; externalCode?: string | null }[]
}): Promise<OrgUnitRow[]> {
  if (data.units.length === 0) return []

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const parent = await client.query<{ path: string; institution_id: string }>(
      'SELECT path, institution_id FROM org_units WHERE id = $1 FOR UPDATE',
      [data.parentId]
    )
    if (!parent.rows[0]) throw new Error('Parent org unit not found')
    if (parent.rows[0].institution_id !== data.institutionId) {
      throw new Error('Parent org unit belongs to a different institution')
    }
    const parentPath = parent.rows[0].path

    const inserted: OrgUnitRow[] = []
    for (const u of data.units) {
      const row = await client.query<OrgUnitRow>(
        `INSERT INTO org_units (institution_id, parent_id, type_code, name, short_name, external_code, path)
         VALUES ($1, $2, $3, $4, $5, $6, '')
         RETURNING *`,
        [data.institutionId, data.parentId, data.typeCode, u.name,
         u.shortName ?? null, u.externalCode ?? null]
      )
      const updated = await client.query<OrgUnitRow>(
        'UPDATE org_units SET path = $2 WHERE id = $1 RETURNING *',
        [row.rows[0].id, `${parentPath}${row.rows[0].id}/`]
      )
      inserted.push(updated.rows[0])
    }

    await client.query('COMMIT')
    return inserted
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export async function updateOrgUnit(
  id: string,
  patch: { name?: string; shortName?: string | null; externalCode?: string | null }
): Promise<OrgUnitRow | null> {
  const { rows } = await pool.query<OrgUnitRow>(
    `UPDATE org_units
        SET name          = COALESCE($2, name),
            short_name    = CASE WHEN $3 THEN $4 ELSE short_name    END,
            external_code = CASE WHEN $5 THEN $6 ELSE external_code END
      WHERE id = $1
      RETURNING *`,
    [id,
     patch.name ?? null,
     patch.shortName    !== undefined, patch.shortName    ?? null,
     patch.externalCode !== undefined, patch.externalCode ?? null]
  )
  return rows[0] ?? null
}

/** Delete a unit. Children CASCADE; role rows on it CASCADE. Refuses to delete
 *  a root institution unit (callers should delete the institution instead). */
export async function deleteOrgUnit(id: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM org_units WHERE id = $1 AND parent_id IS NOT NULL`,
    [id]
  )
  return (rowCount ?? 0) > 0
}

// ─── Role assignment ──────────────────────────────────────────────────────────

export async function addUnitRole(
  teacherId: string,
  orgUnitId: string,
  role: UnitRole
): Promise<UnitRoleRow> {
  const { rows } = await pool.query<UnitRoleRow>(
    `INSERT INTO org_unit_roles (teacher_id, org_unit_id, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (teacher_id, org_unit_id, role) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [teacherId, orgUnitId, role]
  )
  return rows[0]
}

export async function removeUnitRole(
  teacherId: string,
  orgUnitId: string,
  role: UnitRole
): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM org_unit_roles WHERE teacher_id = $1 AND org_unit_id = $2 AND role = $3',
    [teacherId, orgUnitId, role]
  )
  return (rowCount ?? 0) > 0
}

export async function setPrimaryOrgUnit(teacherId: string, orgUnitId: string | null): Promise<void> {
  await pool.query(
    'UPDATE teachers SET primary_org_unit_id = $2 WHERE id = $1',
    [teacherId, orgUnitId]
  )
}

// ─── Members & roles (slice 1b) ───────────────────────────────────────────────

export interface InstitutionMember {
  id:                  string
  email:               string
  name:                string | null
  primary_org_unit_id: string | null
  roles:               { org_unit_id: string; role: string }[]
}

/** All teachers in an institution with their primary unit and unit-role rows —
 *  the data the assignment UI needs in one fetch. */
export async function listInstitutionMembersWithRoles(institutionId: string): Promise<InstitutionMember[]> {
  const { rows } = await pool.query<InstitutionMember>(
    `SELECT t.id, t.email, t.name, t.primary_org_unit_id,
            COALESCE(
              json_agg(json_build_object('org_unit_id', our.org_unit_id, 'role', our.role))
                FILTER (WHERE our.id IS NOT NULL),
              '[]'
            ) AS roles
       FROM teachers t
       LEFT JOIN org_unit_roles our ON our.teacher_id = t.id
      WHERE t.institution_id = $1
      GROUP BY t.id
      ORDER BY t.name NULLS LAST, t.email`,
    [institutionId]
  )
  return rows
}

/** Is this teacher a member of this institution? Guards every member/role op so
 *  an admin can only touch their own institution's teachers. */
export async function isTeacherInInstitution(teacherId: string, institutionId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM teachers WHERE id = $1 AND institution_id = $2) AS ok`,
    [teacherId, institutionId]
  )
  return rows[0]?.ok ?? false
}

/** Count holders of a given role directly on a unit — used to prevent removing
 *  the last admin on the institution root (lockout guard). */
export async function countRoleOnUnit(unitId: string, role: UnitRole): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM org_unit_roles WHERE org_unit_id = $1 AND role = $2`,
    [unitId, role]
  )
  return parseInt(rows[0].count, 10)
}

// ─── Authoritative admin checks (increment 3) ─────────────────────────────────

/** Does this teacher hold `admin` on the root unit of this institution? This is
 *  the authoritative "institution admin" check — single indexed query, used by
 *  the requireInstitutionAdmin guard. (Admin on a sub-unit is NOT institution
 *  admin; institution-wide routes require admin on the root.) */
export async function isInstitutionAdmin(teacherId: string, institutionId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM org_unit_roles our
         JOIN org_units u ON u.id = our.org_unit_id
        WHERE our.teacher_id = $1
          AND our.role = 'admin'
          AND u.institution_id = $2
          AND u.type_code = 'institution'
          AND u.parent_id IS NULL
     ) AS ok`,
    [teacherId, institutionId]
  )
  return rows[0]?.ok ?? false
}

export async function setPlatformAdmin(teacherId: string, value: boolean): Promise<void> {
  await pool.query('UPDATE teachers SET is_platform_admin = $2 WHERE id = $1', [teacherId, value])
}

/**
 * Keep the org-tree authorisation in sync when the legacy `teachers.role` enum
 * is changed by a platform admin. Until every surface is unit-native, role and
 * the tree must agree, or a freshly-promoted admin would be locked out (the
 * guards now read the tree, not the enum).
 *
 *   platform_admin     → is_platform_admin = true
 *   institution_admin  → admin on the institution root unit (if assigned)
 *   anything else       → is_platform_admin = false + admin-on-root revoked
 */
export async function syncRoleToTree(
  teacherId: string,
  role: string,
  institutionId: string | null,
): Promise<void> {
  await setPlatformAdmin(teacherId, role === 'platform_admin')

  if (!institutionId) return
  const root = await getRootUnitForInstitution(institutionId)
  if (!root) return

  if (role === 'institution_admin') {
    await addUnitRole(teacherId, root.id, 'admin')
  } else {
    await removeUnitRole(teacherId, root.id, 'admin')
  }
}
