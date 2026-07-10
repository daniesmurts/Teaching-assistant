import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt'
import { findTeacherRowById, touchLastSeen } from '../db/queries/teachers'
import { computeEffectiveTier } from '../lib/planTier'
import { UnauthorizedError } from '../errors/AppError'

// ─── Extended teacher context attached to every authenticated request ─────────

export interface AuthTeacher {
  id:                  string
  email:               string
  role:                string       // legacy enum: 'teacher' | 'institution_admin' | 'platform_admin'
  plan_tier:           string       // effective tier (may be downgraded if expired)
  institution_id:      string | null
  is_active:           boolean
  // §7 org tree — additive, alongside the legacy `role` until routes migrate.
  primary_org_unit_id: string | null
  is_platform_admin:   boolean       // orthogonal platform-owner flag (preferred over role)
}

declare global {
  namespace Express {
    interface Request {
      teacher: AuthTeacher
    }
  }
}

interface JwtPayload {
  id:    string
  email: string
  iat:   number
  exp:   number
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Требуется авторизация', code: 'UNAUTHORIZED' })
    return
  }

  const token = authHeader.slice(7)

  let payload: JwtPayload
  try {
    payload = verifyToken(token)
  } catch (err) {
    next(err)
    return
  }

  try {
    const row = await findTeacherRowById(payload.id)

    if (!row) {
      res.status(401).json({ error: 'Пользователь не найден', code: 'UNAUTHORIZED' })
      return
    }

    if (!row.is_active) {
      res.status(401).json({ error: 'Аккаунт деактивирован', code: 'ACCOUNT_DISABLED' })
      return
    }

    // Reject token if password was changed after it was issued
    if (row.password_changed_at) {
      const tokenIssuedAt = payload.iat * 1000
      if (tokenIssuedAt < row.password_changed_at.getTime()) {
        res.status(401).json({ error: 'Сессия истекла. Пожалуйста, войдите снова.', code: 'UNAUTHORIZED' })
        return
      }
    }

    // Effective tier (expiry-aware + institution inheritance) — shared with the
    // login route via lib/planTier so the two never disagree.
    const effectiveTier = computeEffectiveTier(row)

    req.teacher = {
      id:                  row.id,
      email:               row.email,
      role:                row.role           ?? 'teacher',
      plan_tier:           effectiveTier,
      institution_id:      row.institution_id ?? null,
      is_active:           row.is_active,
      primary_org_unit_id: row.primary_org_unit_id ?? null,
      is_platform_admin:   row.is_platform_admin   ?? false,
    }
    touchLastSeen(row.id)   // throttled fire-and-forget activity mark
    next()
  } catch (err) {
    next(err)
  }
}
