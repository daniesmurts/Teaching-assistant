import { Request, Response, NextFunction } from 'express'
import { ForbiddenError } from '../errors/AppError'
import { hasLeadershipRole } from '../db/queries/leadership'

// Gate for the /api/leadership/* surface (the «Руководство» page). Passes when
// the caller is the platform owner OR holds head/admin on any unit. Per-unit
// access on each endpoint still goes through canActOnUnit so a head on кафедра
// X can only see X's subtree — this middleware is the cheap discoverability
// check; canActOnUnit is the authoritative per-target check.
export async function requireLeader(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (req.teacher?.is_platform_admin) return next()
    if (req.teacher && (await hasLeadershipRole(req.teacher.id, req.teacher.institution_id))) return next()
    next(new ForbiddenError('Доступно только руководителям подразделений'))
  } catch (err) {
    next(err)
  }
}
