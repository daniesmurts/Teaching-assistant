import { pool } from '../db/connection'

// Role-driven access to «Образовательные программы». Separate from
// requireInstitutionAdmin because the РОП access path is unit-scoped (head on a
// specific program unit) while начальник УМЦ / проректор get aggregate access
// by virtue of their unit *type* (governance / admin_office), not by subtree
// containment.
//
// Correction (2026-07-01): programme content is authored in the university's
// own system; this tool ingests + analyses. In practice РОП + УМЦ + проректор
// all import, correct extracted content, and run analysis together — so unit
// type alone (governance / admin_office) grants full read/write, not read-only
// oversight. Between УМЦ and the РОПы, KNITU has 4 polygroup heads who each
// oversee a subset of РОПы; they need `specific` scope covering their whole
// subtree, not just direct program-unit grants. Same shape for institute
// directors and any kafedra head who happens to have a `program` beneath them.
// A single subtree walk resolves all these cases and dual roles.
// The `all-ro` branch stays for a future viewer-role surface.
//
// Resolution rule:
//   platform owner                            → all-rw
//   admin on the institution root             → all-rw
//   head/admin on governance / admin_office   → all-rw   (проректор, УМЦ)
//   any other head/admin (cluster, division,  → specific — union of every
//   department, program — walks subtree)                  `program` unit in
//                                                         the subtree of any
//                                                         held unit + direct
//                                                         program grants
//   nothing of the above                      → none

export type ProgramAccessScope =
  | { kind: 'all-rw' }
  | { kind: 'all-ro' }
  // `programUnitIds` = readable; `editableUnitIds` ⊆ readable = writable.
  // The two differ when a teacher holds `view` on one subtree and `edit` on
  // another — collapsing them would silently grant edit over the view-only
  // subtree.
  | { kind: 'specific'; programUnitIds: string[]; editableUnitIds: string[] }
  | { kind: 'none' }

interface TeacherIdentity {
  id:                 string
  is_platform_admin:  boolean
  institution_id:     string | null
}

/** Single round trip. Returns the broadest applicable scope — we never need to
 *  enumerate `specific` unit ids if `all-rw` or `all-ro` already applies, since
 *  the route layer treats those as supersets. */
export async function getProgramAccessScope(teacher: TeacherIdentity): Promise<ProgramAccessScope> {
  if (teacher.is_platform_admin) return { kind: 'all-rw' }
  if (!teacher.institution_id)    return { kind: 'none' }

  // Pull every head/admin row this teacher holds, joined to the unit's
  // type_code. One query, then decide in memory.
  //
  // Domain filter (Research.md §7.10 Phase 3) — programmes are curriculum
  // content, so only 'all' (root admin, always domain='all' by the Phase 1
  // validation invariant) or 'curriculum' grants should reach this. Without
  // it, a hypothetical `teaching`-domain edit grant (grantable since Phase 2's
  // role-assignment UI added the 'teaching' domain option) would silently
  // unlock program-editing rights it was never meant to have — same class of
  // cross-domain leak as the Phase 2 leadership-dashboard fix.
  // `view` is included as well as admin/edit (docs/ACCESS-MATRIX.md fix):
  // it used to be filtered out entirely, so a read-only role — Ректор or
  // Проректор holding `curriculum:view` — resolved to `none` and couldn't
  // see a single programme. View grants now yield read-only access at the
  // same breadth their unit type implies.
  const { rows } = await pool.query<{ type_code: string; role: string; org_unit_id: string }>(
    `SELECT u.type_code, our.role, our.org_unit_id
       FROM org_unit_roles our
       JOIN org_units u ON u.id = our.org_unit_id
      WHERE our.teacher_id    = $1
        AND u.institution_id  = $2
        AND our.role IN ('admin', 'edit', 'view')
        AND our.domain IN ('all', 'curriculum')`,
    [teacher.id, teacher.institution_id]
  )

  const writable = rows.filter((r) => r.role === 'admin' || r.role === 'edit')

  // Institution-root admin wins outright — full read/write.
  if (writable.some((r) => r.role === 'admin' && r.type_code === 'institution')) {
    return { kind: 'all-rw' }
  }

  // Governance or admin_office head/admin → institution-wide read + write.
  // Default-on per unit type: any grant of these types implies collaborative
  // authorship rights on all programmes (проректор, начальник УМЦ).
  if (writable.some((r) => r.type_code === 'governance' || r.type_code === 'admin_office')) {
    return { kind: 'all-rw' }
  }

  // Same unit types held at `view` only → institution-wide, read-only.
  if (rows.some((r) => r.type_code === 'governance' || r.type_code === 'admin_office' || r.type_code === 'institution')) {
    return { kind: 'all-ro' }
  }

  // Everything else — cluster (polygroup), division (institute), department
  // (kafedra), or program (РОП) — is subtree-scoped. Walk the materialised
  // path of every held unit and collect every `program` unit within. Dual
  // roles (e.g. polygroup head + direct РОП) fall out of the DISTINCT.
  if (rows.length === 0) return { kind: 'none' }

  const [readable, editable] = await Promise.all([
    programUnitsUnder(rows.map((r) => r.org_unit_id)),
    programUnitsUnder(writable.map((r) => r.org_unit_id)),
  ])
  if (readable.length === 0) return { kind: 'none' }

  return { kind: 'specific', programUnitIds: readable, editableUnitIds: editable }
}

/** Every `program`/`program_direction` unit inside the subtree of any given
 *  unit. Empty input short-circuits — a teacher with only view grants has no
 *  editable units, and `= ANY('{}')` would still cost a round trip. */
async function programUnitsUnder(unitIds: string[]): Promise<string[]> {
  if (unitIds.length === 0) return []
  const { rows } = await pool.query<{ id: string }>(
    `SELECT DISTINCT p.id
       FROM org_units p
       JOIN org_units auth ON auth.institution_id = p.institution_id
                          AND p.path LIKE auth.path || '%'
      WHERE p.type_code IN ('program', 'program_direction')
        AND auth.id = ANY($1::uuid[])`,
    [unitIds]
  )
  return rows.map((r) => r.id)
}

/** True if the scope grants edit access on the program identified by its
 *  linked org_unit_id. Read-only scopes return false. Programs with NULL
 *  org_unit_id can only be edited by `all-rw` (the IT admin must link them
 *  first before any РОП can manage them). */
export function canEditProgram(scope: ProgramAccessScope, programOrgUnitId: string | null): boolean {
  if (scope.kind === 'all-rw') return true
  if (scope.kind === 'specific' && programOrgUnitId) {
    return scope.editableUnitIds.includes(programOrgUnitId)
  }
  return false
}

/** True if the scope grants at least read access on a program. all-rw, all-ro,
 *  and matching `specific` all return true. */
export function canReadProgram(scope: ProgramAccessScope, programOrgUnitId: string | null): boolean {
  if (scope.kind === 'all-rw' || scope.kind === 'all-ro') return true
  if (scope.kind === 'specific' && programOrgUnitId) {
    return scope.programUnitIds.includes(programOrgUnitId)
  }
  return false
}
