import {
  teacherCanActOnUnit,
  canTeacherShareToUnit,
  listRoleScopesForTeacher,
  type TeacherRoleScope,
  type GrantDomain,
} from '../db/queries/orgUnits'

// ─── Pure path semantics (unit-tested in orgScope.test.ts) ────────────────────

/**
 * True when `ancestorPath` denotes a unit that is an ancestor of — or the same
 * unit as — the unit denoted by `descendantPath`. Materialised paths look like
 * '/a/b/c/'; a unit is an ancestor-or-self of another exactly when its path is
 * a prefix of the other's. The trailing slash makes the prefix test exact, so
 * '/a/b/' is NOT treated as a prefix of '/a/bc/'.
 */
export function pathIsAncestorOrSelf(ancestorPath: string, descendantPath: string): boolean {
  if (!ancestorPath || !descendantPath) return false
  return descendantPath.startsWith(ancestorPath)
}

/**
 * In-memory access decision: given the role rows a teacher holds (each carrying
 * the holder unit's path and domain), the target unit's path, the set of
 * acceptable roles, and the domain being checked, decide whether the teacher
 * may act. Pure — no I/O — so it is fully unit-testable and reusable by
 * callers that have already fetched the teacher's scopes (avoids a second
 * round trip on hot paths).
 *
 * `domain='all'` on a held scope always matches, regardless of `domain`
 * asked for — same wildcard semantics as `teacherCanActOnUnit` (Research.md
 * §7.10).
 */
export function evaluateAccess(
  roleScopes:   readonly TeacherRoleScope[],
  targetPath:   string,
  allowedRoles: readonly string[],
  domain:       GrantDomain,
): boolean {
  const allowed = new Set(allowedRoles)
  for (const scope of roleScopes) {
    if (allowed.has(scope.role)
        && (scope.domain === 'all' || scope.domain === domain)
        && pathIsAncestorOrSelf(scope.path, targetPath)) {
      return true
    }
  }
  return false
}

// ─── DB-backed entry points ───────────────────────────────────────────────────

/**
 * Can `teacherId` act on `targetUnitId` in any of `roles`, within `domain`?
 * Authoritative single-query check used by the requireUnitRole middleware.
 * platform_admin is handled by the caller (it is orthogonal to the tree) —
 * this function answers the tree question only.
 */
export async function canActOnUnit(
  teacherId:    string,
  targetUnitId: string,
  roles:        readonly string[],
  domain:       GrantDomain,
): Promise<boolean> {
  return teacherCanActOnUnit(teacherId, targetUnitId, roles, domain)
}

/** Fetch every role scope a teacher holds — for callers that need to make
 *  several access decisions in one request (evaluate with evaluateAccess). */
export async function loadRoleScopes(teacherId: string): Promise<TeacherRoleScope[]> {
  return listRoleScopesForTeacher(teacherId)
}

/** May `teacherId` share a rubric/criterion into `targetUnitId`? See
 *  canTeacherShareToUnit for the exact rule (own chain, or head/admin). */
export async function canShareToUnit(teacherId: string, targetUnitId: string): Promise<boolean> {
  return canTeacherShareToUnit(teacherId, targetUnitId)
}
