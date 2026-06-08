import { Request, Response, NextFunction } from 'express'
import { verifyToken } from '../lib/jwt'
import { findTeacherRowById } from '../db/queries/teachers'
import { UnauthorizedError } from '../errors/AppError'

// ─── Extended teacher context attached to every authenticated request ─────────

export interface AuthTeacher {
  id:             string
  email:          string
  role:           string       // 'teacher' | 'institution_admin' | 'platform_admin'
  plan_tier:      string       // effective tier (may be downgraded if expired)
  institution_id: string | null
  is_active:      boolean
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

// Rank plan tiers so we can pick the strongest entitlement.
const TIER_RANK: Record<string, number> = { free: 0, pro: 1, institution: 2 }
function strongerTier(a: string, b: string): string {
  return (TIER_RANK[a] ?? 0) >= (TIER_RANK[b] ?? 0) ? a : b
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

    // Own tier — downgraded to free if an individual subscription has expired
    // (never rely on a cron job for this).
    const ownTier =
      row.plan_expires_at && row.plan_expires_at < new Date()
        ? 'free'
        : (row.plan_tier ?? 'free')

    // Active members inherit their institution's tier. Effective tier is the
    // strongest of the two — so a seat at an 'institution' org grants full
    // entitlements even if the teacher's personal plan is free.
    const institutionTier = row.institution_id ? (row.institution_plan_tier ?? 'free') : 'free'
    const effectiveTier = strongerTier(ownTier, institutionTier)

    req.teacher = {
      id:             row.id,
      email:          row.email,
      role:           row.role           ?? 'teacher',
      plan_tier:      effectiveTier,
      institution_id: row.institution_id ?? null,
      is_active:      row.is_active,
    }
    next()
  } catch (err) {
    next(err)
  }
}
