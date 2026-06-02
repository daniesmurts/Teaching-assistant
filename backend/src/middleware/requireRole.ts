import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../errors/AppError'

type Role = 'teacher' | 'institution_admin' | 'platform_admin'

/**
 * Returns middleware that rejects requests from teachers whose role
 * is not in the allowed list.
 *
 * Platform admin can always access everything — this matches the CLAUDE.md spec.
 */
export function requireRole(allowed: Role | Role[]) {
  const allowedRoles = Array.isArray(allowed) ? allowed : [allowed]

  return (req: Request, _res: Response, next: NextFunction) => {
    const role = req.teacher?.role as Role

    // Platform admin bypasses all role checks
    if (role === 'platform_admin') return next()

    if (!allowedRoles.includes(role)) {
      return next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
    }
    next()
  }
}

// ─── Convenience exports ──────────────────────────────────────────────────────

/** Only platform admin */
export const requireAdmin = requireRole('platform_admin')

/** Institution admin or platform admin */
export const requireInstitutionAdmin = requireRole(['institution_admin', 'platform_admin'])
