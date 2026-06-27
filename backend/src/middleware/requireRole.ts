import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../errors/AppError'
import { isInstitutionAdmin } from '../db/queries/orgUnits'

// Authorisation now resolves through the §7 org tree, not the legacy
// `teachers.role` enum. These convenience guards are the institution-wide
// checks every admin/institution route already used — same names, same import
// path, reimplemented on the authoritative primitives:
//   • platform owner  → teachers.is_platform_admin (orthogonal flag)
//   • institution admin → `admin` role on the institution root unit
// The enum is kept in sync by syncRoleToTree (admin teacher-management) so the
// role-based frontend gate keeps working, but it is no longer authoritative
// server-side. Per-subtree scoping (a division admin limited to their subtree)
// is future work — these guards remain institution-wide.

/** Only the platform owner. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.teacher?.is_platform_admin) return next()
  next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
}

/** Institution admin (admin on the institution root) or the platform owner. */
export async function requireInstitutionAdmin(
  req: Request, _res: Response, next: NextFunction
): Promise<void> {
  try {
    if (req.teacher?.is_platform_admin) return next()
    const instId = req.teacher?.institution_id
    if (instId && (await isInstitutionAdmin(req.teacher.id, instId))) return next()
    next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
  } catch (err) {
    next(err)
  }
}
