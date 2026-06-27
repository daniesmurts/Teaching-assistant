import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../errors/AppError'
import { canActOnUnit } from '../services/orgScope'
import type { UnitRole } from '../db/queries/orgUnits'

// ─── Unit-scoped authoriser (Research.md §7.3, CLAUDE.md target middleware) ────
//
// Shifts from "does this teacher hold this role" to "can this teacher act on
// THIS unit in this role." Authorisation walks the materialised path: a role on
// any ancestor unit grants the same role on descendants.
//
// Use this for routes that act on a SPECIFIC unit. The institution-wide
// convenience guards (requireAdmin / requireInstitutionAdmin in requireRole.ts)
// are also tree-backed now and cover the institution-scoped admin routes.

/**
 * platform_admin remains orthogonal to the tree: a flat flag, not a unit role.
 * It short-circuits every unit-scope check. Prefer this over the legacy
 * requireRole('platform_admin') for new routes.
 */
export function requirePlatformAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.teacher?.is_platform_admin) return next()
  next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
}

/**
 * Per-route guard: resolve the target org unit from the request, then ask
 * whether the calling teacher holds any of `roles` on that unit or any
 * ancestor. platform_admin bypasses the check.
 *
 * `resolveUnit` returns the target org_unit_id (e.g. from a path param, or by
 * looking up the unit that owns the resource being acted on).
 */
export function requireUnitRole(
  resolveUnit: (req: Request) => Promise<string | null>,
  roles: UnitRole[],
) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.teacher?.is_platform_admin) return next()

      const unitId = await resolveUnit(req)
      if (!unitId) {
        return next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
      }

      const ok = await canActOnUnit(req.teacher.id, unitId, roles)
      if (!ok) {
        return next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

/** Common resolver: the target unit is named by a route param (default `:unitId`). */
export function unitFromParam(param = 'unitId') {
  return async (req: Request): Promise<string | null> => req.params[param] ?? null
}
