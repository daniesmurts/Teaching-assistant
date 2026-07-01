import { pool } from '../db/connection'

// Role-driven access to «Образовательные программы». Separate from
// requireInstitutionAdmin because the РОП access path is unit-scoped (head on a
// specific program unit) while начальник УМЦ / проректор get aggregate
// read-only access by virtue of their unit *type* (governance / admin_office),
// not by subtree containment.
//
// Resolution rule (default-on for unit type):
//   platform owner                            → all-rw
//   admin on the institution root             → all-rw
//   head/admin on a governance unit           → all-ro
//   head/admin on an admin_office unit (УМЦ)  → all-ro
//   head/admin on a program unit (РОП)        → specific
//   nothing of the above                      → none

export type ProgramAccessScope =
  | { kind: 'all-rw' }
  | { kind: 'all-ro' }
  | { kind: 'specific'; programUnitIds: string[] }
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
  const { rows } = await pool.query<{ type_code: string; role: string; org_unit_id: string }>(
    `SELECT u.type_code, our.role, our.org_unit_id
       FROM org_unit_roles our
       JOIN org_units u ON u.id = our.org_unit_id
      WHERE our.teacher_id    = $1
        AND u.institution_id  = $2
        AND our.role IN ('admin', 'head')`,
    [teacher.id, teacher.institution_id]
  )

  // Institution-root admin wins outright — full read/write.
  if (rows.some((r) => r.role === 'admin' && r.type_code === 'institution')) {
    return { kind: 'all-rw' }
  }

  // Governance or admin_office head/admin → aggregate read-only oversight.
  // Default-on per unit type: any grant of these types implies oversight.
  if (rows.some((r) => r.type_code === 'governance' || r.type_code === 'admin_office')) {
    return { kind: 'all-ro' }
  }

  // Specific program unit grants (РОП). May hold several.
  const programUnitIds = rows.filter((r) => r.type_code === 'program').map((r) => r.org_unit_id)
  if (programUnitIds.length > 0) return { kind: 'specific', programUnitIds }

  return { kind: 'none' }
}

/** True if the scope grants edit access on the program identified by its
 *  linked org_unit_id. Read-only scopes return false. Programs with NULL
 *  org_unit_id can only be edited by `all-rw` (the IT admin must link them
 *  first before any РОП can manage them). */
export function canEditProgram(scope: ProgramAccessScope, programOrgUnitId: string | null): boolean {
  if (scope.kind === 'all-rw') return true
  if (scope.kind === 'specific' && programOrgUnitId) {
    return scope.programUnitIds.includes(programOrgUnitId)
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
