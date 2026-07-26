import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../errors/AppError'
import { getAccessScope, resolveGrant, type AccessLevel, type DomainGrant } from '../services/accessScope'
import type { Domain } from '../db/queries/orgUnits'

// Extends the request with the resolved grant so downstream handlers can read
// pathPrefixes without re-resolving (same pattern as requireProgramAccess).
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      domainScope?: DomainGrant
    }
  }
}

/** Gate for Research.md §7.10 functional-authority domains (Phase 1:
 *  'curriculum' only). Platform owner bypasses. Otherwise resolves the
 *  caller's access scope and requires at least `minLevel` on `domain` —
 *  an institution-root admin's domain='all' grant satisfies this the same
 *  as a scoped domain='curriculum' grant would. */
export function requireDomain(domain: Domain, minLevel: AccessLevel) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.teacher?.is_platform_admin) { next(); return }

      const scope = await getAccessScope({
        id:                req.teacher.id,
        is_platform_admin: req.teacher.is_platform_admin,
        institution_id:    req.teacher.institution_id,
      })
      // Every grant meeting minLevel contributes its path — so a teacher who
      // holds a broad `view` grant AND a narrow `admin` one keeps the broad
      // reach on view-level routes instead of being silently narrowed to the
      // admin grant's subtree (see getAccessScope's contract).
      const grant = resolveGrant(scope, domain, minLevel)
      if (grant) {
        req.domainScope = grant
        next()
        return
      }
      next(new ForbiddenError('Недостаточно прав для выполнения этого действия'))
    } catch (err) {
      next(err)
    }
  }
}
