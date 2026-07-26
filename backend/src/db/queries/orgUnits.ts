import { pool } from '../connection'

// ─── Canonical taxonomy (Research.md §7.1) ────────────────────────────────────

export const ORG_UNIT_TYPES = [
  'institution',
  'governance',
  'admin_office',
  'cluster',           // displayed as «Полигруппа» — renamed from «Кластер направлений»
  'division',
  'ugsn',              // «УГСН» — укрупнённая группа, the XX.00.00 grouping (e.g. 09.00.00 Информатика
                       // и вычислительная техника). Pure grouping tier: NOT a programme anchor,
                       // carries no ФГОС metadata.
  'program_direction', // «Направление подготовки / специальность» — the ФГОС level (e.g. 09.03.04
                       // Программная инженерия). Parent of its ОП/профили.
  'program',           // «Образовательная программа» — a профиль/направленность under a направление
                       // (e.g. «Искусственный интеллект и большие данные» under 01.03.02).
                       // РОП head grants + `programs.org_unit_id` can attach at either programme
                       // level: a направление with a single ОП can stay a leaf without ОП children.
  'department',
] as const
export type OrgUnitType = (typeof ORG_UNIT_TYPES)[number]

export const UNIT_ROLES = ['admin', 'edit', 'view'] as const
export type UnitRole = (typeof UNIT_ROLES)[number]

// Research.md §7.10 — the functional-authority axis. 'all' is a grant-time
// wildcard (today's institution-root admins) that the resolver
// (services/accessScope.ts) expands across every concrete domain below.
//
// 'umu' (docs/ACCESS-MATRIX.md) separates УМУ/УМЦ office tooling — today the
// РПД monitor — from `curriculum` content authority. Without it a Заведующий
// кафедрой, who legitimately needs `curriculum:edit` to author criteria,
// would also see institution-wide РПД filing compliance: two features at the
// same domain+level can't be told apart, so the split has to be a domain.
// No migration needed — org_unit_roles.domain is free-text (087), and the
// only grants in existence are domain='all', which expands to include it.
export const DOMAINS = ['platform', 'curriculum', 'teaching', 'umu'] as const
export type Domain = (typeof DOMAINS)[number]
export const GRANT_DOMAINS = ['all', ...DOMAINS] as const
export type GrantDomain = (typeof GRANT_DOMAINS)[number]

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
  // Programme metadata (migration 055) — meaningful only for program /
  // program_direction units; NULL elsewhere. Prefills the РОП import form.
  code:            string | null
  specialty_name:  string | null
  education_level: string | null
  forms_of_study:  string | null
}

/** The programme-metadata subset an admin can set on a program/program_direction
 *  unit. All optional; omitted keys are left untouched on update. */
export interface OrgUnitProgrammeMeta {
  code?:            string | null
  specialtyName?:   string | null
  educationLevel?:  string | null
  formsOfStudy?:    string | null
}

export interface UnitRoleRow {
  id:          string
  teacher_id:  string
  org_unit_id: string
  role:        string
  domain:      string
  created_at:  Date
}

/** A teacher's role rows joined to the unit `path` — enough to evaluate scope
 *  in memory without a second round trip. */
export interface TeacherRoleScope {
  org_unit_id: string
  role:        string
  domain:      string
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
 *  as 6-6 / 6-3 / 6-5 / … in the structure list.
 *
 *  `unitPathPrefixes` — Research.md §7.10 Phase 3 slice B. Omitted →
 *  unrestricted (platform-admin bypass). Every org unit has a real `path`
 *  (unlike teachers, which can have a NULL primary unit), so a root-anchored
 *  `[rootPath]` filter naturally matches every unit in the institution —
 *  no orphan-row special-casing needed, unlike the teaching-domain queries
 *  in db/queries/institutions.ts. */
export async function listOrgUnitsWithCounts(
  institutionId: string,
  unitPathPrefixes?: string[]
): Promise<OrgUnitWithCount[]> {
  const { rows } = await pool.query<OrgUnitWithCount>(
    `SELECT u.*,
            (SELECT COUNT(*)::int
               FROM teachers t
               JOIN org_units pu ON pu.id = t.primary_org_unit_id
              WHERE pu.path LIKE u.path || '%') AS member_count
       FROM org_units u
      WHERE u.institution_id = $1
        AND ($2::text[] IS NULL OR EXISTS (
              SELECT 1 FROM unnest($2::text[]) AS prefix WHERE u.path LIKE prefix || '%'
            ))
      ORDER BY u.created_at`,
    [institutionId, unitPathPrefixes ?? null]
  )
  return rows
}

/** Direct children + subtree member counts + linked programmes — used to block
 *  destructive deletes until the admin has moved everything out of a unit.
 *  `programs` counts rows linked to THIS unit only (not the subtree): deletion
 *  already requires zero children, so the unit itself is the only possible
 *  link carrier at delete time. Without this guard the FK's ON DELETE SET NULL
 *  would silently unlink the programme and strand its РОП. */
export async function getOrgUnitDependents(
  unitId: string
): Promise<{ children: number; members: number; programs: number }> {
  const { rows } = await pool.query<{ children: string; members: string; programs: string }>(
    `SELECT
       (SELECT COUNT(*) FROM org_units c WHERE c.parent_id = $1) AS children,
       (SELECT COUNT(*) FROM teachers t
          JOIN org_units pu ON pu.id = t.primary_org_unit_id
          JOIN org_units u  ON u.id = $1
         WHERE pu.path LIKE u.path || '%') AS members,
       (SELECT COUNT(*) FROM programs p WHERE p.org_unit_id = $1) AS programs`,
    [unitId]
  )
  return {
    children: parseInt(rows[0].children, 10),
    members:  parseInt(rows[0].members, 10),
    programs: parseInt(rows[0].programs, 10),
  }
}

/** Ancestor chain of a unit — from the institution root down to (but excluding)
 *  the unit itself, ordered root-first. Cheap: single query using the
 *  materialised path prefix. Used by the programs breadcrumb: an РОП needs to
 *  see which институт contains their programme without navigating anywhere. */
export async function listAncestorsOfUnit(unitId: string): Promise<OrgUnitRow[]> {
  const { rows } = await pool.query<OrgUnitRow>(
    `SELECT a.*
       FROM org_units target
       JOIN org_units a ON a.institution_id = target.institution_id
                       AND target.path LIKE a.path || '%'
                       AND a.id <> target.id
      WHERE target.id = $1
      ORDER BY a.path`,
    [unitId]
  )
  return rows
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
    `SELECT our.org_unit_id, our.role, our.domain, u.path
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
 *
 * `domain` is required, not optional — Research.md §7.10. Before Phase 2 this
 * matched on role alone, which meant a `domain='curriculum'` grant (role
 * 'edit') silently satisfied checks meant for `domain='teaching'` surfaces
 * (`hasLeadershipRole`, `routes/leadership.ts`) — a real cross-domain leak,
 * closed by requiring every caller to state which domain it's checking.
 * `domain='all'` on the held grant always matches, regardless of what the
 * caller asks for (it's the "full access" wildcard from the 1b backfill).
 */
export async function teacherCanActOnUnit(
  teacherId:    string,
  targetUnitId: string,
  roles:        readonly string[],
  domain:       GrantDomain
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM org_unit_roles our
         JOIN org_units holder ON holder.id = our.org_unit_id
         JOIN org_units target ON target.id = $2
        WHERE our.teacher_id = $1
          AND our.role = ANY($3::text[])
          AND (our.domain = 'all' OR our.domain = $4)
          AND target.path LIKE holder.path || '%'
     ) AS ok`,
    [teacherId, targetUnitId, roles as string[], domain]
  )
  return rows[0]?.ok ?? false
}

/**
 * The teacher's own ancestor-or-self chain — their department, its parent
 * faculty/cluster, … up to the institution root — root-first. This is the
 * set of units a teacher may share a rubric/criterion with without needing
 * any special role (sharing "up" their own chain).
 */
export async function listShareTargetsForTeacher(teacherId: string): Promise<OrgUnitRow[]> {
  const { rows } = await pool.query<OrgUnitRow>(
    `SELECT a.*
       FROM teachers t
       JOIN org_units mine ON mine.id = t.primary_org_unit_id
       JOIN org_units a ON a.institution_id = mine.institution_id
                       AND mine.path LIKE a.path || '%'
      WHERE t.id = $1
      ORDER BY a.path`,
    [teacherId]
  )
  return rows
}

/**
 * May `teacherId` share a rubric/criterion with `targetUnitId`? True when
 * either:
 *   - targetUnitId is an ancestor-or-self of the teacher's own primary unit
 *     (their department, their faculty, or the whole institution) — any
 *     teacher may share "up" their own chain without needing a role, or
 *   - the teacher holds head/admin on targetUnitId or an ancestor of it,
 *     within the 'curriculum' domain (rubric/criterion content — Research.md
 *     §7.10 Phase 3; a `teaching`-domain grant must not unlock this, same
 *     class of cross-domain leak as the Phase 2 leadership fix) — a unit
 *     head sharing into a unit they administer, even if it isn't on their
 *     own personal chain.
 */
export async function canTeacherShareToUnit(
  teacherId: string,
  targetUnitId: string
): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT (
       EXISTS (
         SELECT 1
           FROM teachers me
           JOIN org_units target ON target.id = $2
           LEFT JOIN org_units mine ON mine.id = me.primary_org_unit_id
          WHERE me.id = $1
            AND mine.path IS NOT NULL
            AND mine.path LIKE target.path || '%'
       )
       OR EXISTS (
         SELECT 1
           FROM org_unit_roles our
           JOIN org_units holder ON holder.id = our.org_unit_id
           JOIN org_units target ON target.id = $2
          WHERE our.teacher_id = $1
            AND our.role = ANY(ARRAY['edit', 'admin'])
            AND our.domain = ANY(ARRAY['all', 'curriculum'])
            AND target.path LIKE holder.path || '%'
       )
     ) AS ok`,
    [teacherId, targetUnitId]
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
  meta?:         OrgUnitProgrammeMeta
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
      `INSERT INTO org_units
         (institution_id, parent_id, type_code, name, short_name, external_code, path,
          code, specialty_name, education_level, forms_of_study)
       VALUES ($1, $2, $3, $4, $5, $6, '', $7, $8, $9, $10)
       RETURNING *`,
      [data.institutionId, data.parentId, data.typeCode, data.name,
       data.shortName ?? null, data.externalCode ?? null,
       data.meta?.code ?? null, data.meta?.specialtyName ?? null,
       data.meta?.educationLevel ?? null, data.meta?.formsOfStudy ?? null]
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
  patch: {
    name?: string; shortName?: string | null; externalCode?: string | null
  } & OrgUnitProgrammeMeta
): Promise<OrgUnitRow | null> {
  // Each nullable field uses a "was this key present?" boolean so an explicit
  // null clears it while an absent key leaves the column untouched — same
  // pattern as short_name / external_code.
  const { rows } = await pool.query<OrgUnitRow>(
    `UPDATE org_units
        SET name            = COALESCE($2, name),
            short_name      = CASE WHEN $3  THEN $4  ELSE short_name      END,
            external_code   = CASE WHEN $5  THEN $6  ELSE external_code   END,
            code            = CASE WHEN $7  THEN $8  ELSE code            END,
            specialty_name  = CASE WHEN $9  THEN $10 ELSE specialty_name  END,
            education_level = CASE WHEN $11 THEN $12 ELSE education_level END,
            forms_of_study  = CASE WHEN $13 THEN $14 ELSE forms_of_study  END
      WHERE id = $1
      RETURNING *`,
    [id,
     patch.name ?? null,
     patch.shortName      !== undefined, patch.shortName      ?? null,
     patch.externalCode   !== undefined, patch.externalCode   ?? null,
     patch.code           !== undefined, patch.code           ?? null,
     patch.specialtyName  !== undefined, patch.specialtyName  ?? null,
     patch.educationLevel !== undefined, patch.educationLevel ?? null,
     patch.formsOfStudy   !== undefined, patch.formsOfStudy   ?? null]
  )
  return rows[0] ?? null
}

/** Change a unit's type. The route layer enforces the semantic constraints
 *  (not the root; can't leave `department` while teachers point at it; can't
 *  leave the program/program_direction pair while a programme is linked) —
 *  this just performs the write on a non-root unit. */
export async function retypeOrgUnit(id: string, typeCode: OrgUnitType): Promise<OrgUnitRow | null> {
  const { rows } = await pool.query<OrgUnitRow>(
    `UPDATE org_units SET type_code = $2 WHERE id = $1 AND parent_id IS NOT NULL RETURNING *`,
    [id, typeCode]
  )
  return rows[0] ?? null
}

/** Teachers whose primary department is THIS unit (direct, not subtree) —
 *  used to block re-typing a department away while members point at it. */
export async function countDirectPrimaryMembers(unitId: string): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count FROM teachers WHERE primary_org_unit_id = $1`,
    [unitId]
  )
  return parseInt(rows[0].count, 10)
}

/**
 * Re-parent a unit (and implicitly its whole subtree) under a new parent in
 * the same institution. Recomputes the materialised path for the unit and
 * every descendant in one prefix-rewrite UPDATE. Refuses cycles (new parent
 * inside the unit's own subtree) and cross-institution moves. Returns the
 * updated unit, or null if the unit/parent vanished mid-flight.
 */
export async function moveOrgUnit(
  unitId: string,
  newParentId: string,
  institutionId: string
): Promise<OrgUnitRow | null> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const unitQ = await client.query<OrgUnitRow>(
      'SELECT * FROM org_units WHERE id = $1 AND institution_id = $2 FOR UPDATE',
      [unitId, institutionId]
    )
    const unit = unitQ.rows[0]
    if (!unit || !unit.parent_id) { await client.query('ROLLBACK'); return null }

    const parentQ = await client.query<OrgUnitRow>(
      'SELECT * FROM org_units WHERE id = $1 AND institution_id = $2 FOR UPDATE',
      [newParentId, institutionId]
    )
    const parent = parentQ.rows[0]
    if (!parent) { await client.query('ROLLBACK'); return null }

    if (parent.id === unit.id || parent.path.startsWith(unit.path)) {
      await client.query('ROLLBACK')
      throw new Error('CYCLE') // route maps to a clean Russian error
    }

    const oldPath = unit.path
    const newPath = `${parent.path}${unit.id}/`

    await client.query(
      'UPDATE org_units SET parent_id = $2 WHERE id = $1',
      [unit.id, parent.id]
    )
    // Rewrite the prefix for the unit and its entire subtree in one pass.
    await client.query(
      `UPDATE org_units
          SET path = $2 || substring(path FROM length($1) + 1)
        WHERE path LIKE $1 || '%'`,
      [oldPath, newPath]
    )

    const updated = await client.query<OrgUnitRow>('SELECT * FROM org_units WHERE id = $1', [unit.id])
    await client.query('COMMIT')
    return updated.rows[0]
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
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
  role: UnitRole,
  domain: GrantDomain = 'all'
): Promise<UnitRoleRow> {
  const { rows } = await pool.query<UnitRoleRow>(
    `INSERT INTO org_unit_roles (teacher_id, org_unit_id, role, domain)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (teacher_id, org_unit_id, role, domain) DO UPDATE SET role = EXCLUDED.role
     RETURNING *`,
    [teacherId, orgUnitId, role, domain]
  )
  return rows[0]
}

export async function removeUnitRole(
  teacherId: string,
  orgUnitId: string,
  role: UnitRole,
  domain: GrantDomain = 'all'
): Promise<boolean> {
  const { rowCount } = await pool.query(
    'DELETE FROM org_unit_roles WHERE teacher_id = $1 AND org_unit_id = $2 AND role = $3 AND domain = $4',
    [teacherId, orgUnitId, role, domain]
  )
  return (rowCount ?? 0) > 0
}

export async function setPrimaryOrgUnit(teacherId: string, orgUnitId: string | null): Promise<void> {
  await pool.query(
    'UPDATE teachers SET primary_org_unit_id = $2 WHERE id = $1',
    [teacherId, orgUnitId]
  )
}

/**
 * Place a teacher into their institution's default department if they have no
 * primary unit yet. Prefers the seeded «Кафедра (по умолчанию)», falls back to
 * the institution's oldest department, does nothing if the institution has no
 * departments at all. Never overwrites an existing assignment — the admin's
 * explicit placement always wins. Called on every path that attaches a teacher
 * to an institution (register via invite / auto-join, SAML JIT, admin move) so
 * new members are visible in leadership dashboards and structure headcounts
 * instead of silently floating outside the tree.
 */
export async function assignDefaultDepartmentIfUnset(
  teacherId: string,
  institutionId: string
): Promise<void> {
  await pool.query(
    `UPDATE teachers t
        SET primary_org_unit_id = d.id
       FROM (SELECT id
               FROM org_units
              WHERE institution_id = $2 AND type_code = 'department'
              ORDER BY (name = 'Кафедра (по умолчанию)') DESC, created_at ASC
              LIMIT 1) d
      WHERE t.id = $1
        AND t.primary_org_unit_id IS NULL`,
    [teacherId, institutionId]
  )
}

/**
 * Remove every org-tree tie a teacher holds outside `institutionId` — their
 * unit roles and (if it points into a foreign tree) their primary department.
 * Called when a platform admin moves a teacher between institutions: without
 * this, the stale rows keep granting leadership/programme visibility into the
 * OLD institution and keep the teacher drillable by the old org's heads.
 * `institutionId = null` (teacher detached from any institution) clears all
 * ties. Transactional so the two clears can't diverge.
 */
export async function clearOrgTiesOutsideInstitution(
  teacherId: string,
  institutionId: string | null
): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    if (institutionId) {
      await client.query(
        `DELETE FROM org_unit_roles our
          USING org_units u
          WHERE our.teacher_id = $1
            AND u.id = our.org_unit_id
            AND u.institution_id <> $2`,
        [teacherId, institutionId]
      )
      await client.query(
        `UPDATE teachers t
            SET primary_org_unit_id = NULL
           FROM org_units u
          WHERE t.id = $1
            AND u.id = t.primary_org_unit_id
            AND u.institution_id <> $2`,
        [teacherId, institutionId]
      )
    } else {
      await client.query('DELETE FROM org_unit_roles WHERE teacher_id = $1', [teacherId])
      await client.query('UPDATE teachers SET primary_org_unit_id = NULL WHERE id = $1', [teacherId])
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

// ─── Members & roles (slice 1b) ───────────────────────────────────────────────

export interface InstitutionMember {
  id:                  string
  email:               string
  name:                string | null
  primary_org_unit_id: string | null
  roles:               { org_unit_id: string; role: string; domain: string }[]
}

/** All teachers in an institution with their primary unit and unit-role rows —
 *  the data the assignment UI needs in one fetch. `domain` is included so the
 *  UI can target the exact row for revoke (uniqueness is now
 *  (teacher_id, org_unit_id, role, domain), not (teacher_id, org_unit_id, role) —
 *  Research.md §7.10).
 *
 *  `unitPathPrefixes` — Phase 3 slice B. Omitted → unrestricted. When
 *  provided, filters to teachers whose `primary_org_unit_id` falls under one
 *  of the prefixes (teachers with no primary unit are excluded — same
 *  reasoning as the teaching-domain roster query in db/queries/institutions.ts)
 *  — this is what lets a sub-unit admin's role-grant picker show only their
 *  own people. */
export async function listInstitutionMembersWithRoles(
  institutionId: string,
  unitPathPrefixes?: string[]
): Promise<InstitutionMember[]> {
  const { rows } = await pool.query<InstitutionMember>(
    `SELECT t.id, t.email, t.name, t.primary_org_unit_id,
            COALESCE(
              json_agg(json_build_object('org_unit_id', our.org_unit_id, 'role', our.role, 'domain', our.domain))
                FILTER (WHERE our.id IS NOT NULL),
              '[]'
            ) AS roles
       FROM teachers t
       LEFT JOIN org_unit_roles our ON our.teacher_id = t.id
       LEFT JOIN org_units pu ON pu.id = t.primary_org_unit_id
      WHERE t.institution_id = $1
        AND ($2::text[] IS NULL OR EXISTS (
              SELECT 1 FROM unnest($2::text[]) AS prefix WHERE pu.path LIKE prefix || '%'
            ))
      GROUP BY t.id
      ORDER BY t.name NULLS LAST, t.email`,
    [institutionId, unitPathPrefixes ?? null]
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

/** Count ACTIVE holders of a given role directly on a unit — used to prevent
 *  removing the last admin on the institution root (lockout guard). Joins
 *  teachers.is_active: a deactivated admin can't log in, so counting them
 *  would let the guard wave through a revocation that locks the org out. */
/** domain defaults to 'all' — the lockout guard cares about true (full-scope)
 *  admins; a domain='curriculum' admin grant must never count toward it (see
 *  isInstitutionAdmin below for the same reasoning). */
export async function countRoleOnUnit(unitId: string, role: UnitRole, domain: GrantDomain = 'all'): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*) AS count
       FROM org_unit_roles our
       JOIN teachers t ON t.id = our.teacher_id
      WHERE our.org_unit_id = $1 AND our.role = $2 AND our.domain = $3 AND t.is_active`,
    [unitId, role, domain]
  )
  return parseInt(rows[0].count, 10)
}

// ─── Authoritative admin checks (increment 3) ─────────────────────────────────

/** Does this teacher hold `admin` on the root unit of this institution? This is
 *  the authoritative "institution admin" check — single indexed query, used by
 *  the requireInstitutionAdmin guard. (Admin on a sub-unit is NOT institution
 *  admin; institution-wide routes require admin on the root.)
 *
 *  `domain = 'all'` is required, not just role='admin' — Research.md §7.10
 *  introduces domain-scoped admin grants (e.g. a future domain='curriculum'
 *  admin at root); without this filter such a grant would be indistinguishable
 *  from true institution-root admin here, a privilege-escalation bug. */
export async function isInstitutionAdmin(teacherId: string, institutionId: string): Promise<boolean> {
  const { rows } = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM org_unit_roles our
         JOIN org_units u ON u.id = our.org_unit_id
        WHERE our.teacher_id = $1
          AND our.role = 'admin'
          AND our.domain = 'all'
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
