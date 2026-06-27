import {
  teacherCanActOnUnit,
  listRoleScopesForTeacher,
  type TeacherRoleScope,
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
 * the holder unit's path), the target unit's path, and the set of acceptable
 * roles, decide whether the teacher may act. Pure — no I/O — so it is fully
 * unit-testable and reusable by callers that have already fetched the teacher's
 * scopes (avoids a second round trip on hot paths).
 */
export function evaluateAccess(
  roleScopes:   readonly TeacherRoleScope[],
  targetPath:   string,
  allowedRoles: readonly string[],
): boolean {
  const allowed = new Set(allowedRoles)
  for (const scope of roleScopes) {
    if (allowed.has(scope.role) && pathIsAncestorOrSelf(scope.path, targetPath)) {
      return true
    }
  }
  return false
}

// ─── DB-backed entry points ───────────────────────────────────────────────────

/**
 * Can `teacherId` act on `targetUnitId` in any of `roles`? Authoritative
 * single-query check used by the requireUnitRole middleware. platform_admin is
 * handled by the caller (it is orthogonal to the tree) — this function answers
 * the tree question only.
 */
export async function canActOnUnit(
  teacherId:    string,
  targetUnitId: string,
  roles:        readonly string[],
): Promise<boolean> {
  return teacherCanActOnUnit(teacherId, targetUnitId, roles)
}

/** Fetch every role scope a teacher holds — for callers that need to make
 *  several access decisions in one request (evaluate with evaluateAccess). */
export async function loadRoleScopes(teacherId: string): Promise<TeacherRoleScope[]> {
  return listRoleScopesForTeacher(teacherId)
}
