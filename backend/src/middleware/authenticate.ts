import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
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

  const token  = authHeader.slice(7)
  const secret = process.env.JWT_SECRET
  if (!secret) {
    res.status(500).json({ error: 'Ошибка конфигурации сервера' })
    return
  }

  let payload: JwtPayload
  try {
    payload = jwt.verify(token, secret) as JwtPayload
  } catch {
    res.status(401).json({ error: 'Сессия истекла. Пожалуйста, войдите снова.', code: 'UNAUTHORIZED' })
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

    // Downgrade to free if subscription has expired — never rely on a cron job for this
    const effectiveTier =
      row.plan_expires_at && row.plan_expires_at < new Date()
        ? 'free'
        : (row.plan_tier ?? 'free')

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
