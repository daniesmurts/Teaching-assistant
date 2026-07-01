import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../errors/AppError'
import { getProgramAccessScope, type ProgramAccessScope } from '../services/programAccess'

// Extends the request with the caller's resolved access scope so downstream
// handlers can decide list-filter / edit-gate without re-querying.
declare global {
  namespace Express {
    // eslint-disable-next-line @typescript-eslint/no-empty-interface
    interface Request {
      programAccessScope?: ProgramAccessScope
    }
  }
}

// Discoverability gate for /api/programs/*. 403s if the caller has no path
// into the feature at all (regular teacher). Callers that pass through still
// need per-program checks (canEditProgram / canReadProgram) on write paths —
// this middleware only rules out the obvious no-access case.
export async function requireProgramAccess(
  req: Request, _res: Response, next: NextFunction
): Promise<void> {
  try {
    const scope = await getProgramAccessScope({
      id:                req.teacher.id,
      is_platform_admin: req.teacher.is_platform_admin,
      institution_id:    req.teacher.institution_id,
    })
    if (scope.kind === 'none') {
      return next(new ForbiddenError('Доступно только руководителям образовательных программ и администраторам'))
    }
    req.programAccessScope = scope
    next()
  } catch (err) {
    next(err)
  }
}
