import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

// ─── Extend Express Request ───────────────────────────────────────────────────

export interface JwtPayload {
  id: string
  email: string
  iat: number
  exp: number
}

declare global {
  namespace Express {
    interface Request {
      teacher: JwtPayload
    }
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization

  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' })
    return
  }

  const token = authHeader.slice(7)
  const secret = process.env.JWT_SECRET

  if (!secret) {
    res.status(500).json({ error: 'Server misconfiguration: JWT_SECRET not set' })
    return
  }

  try {
    const payload = jwt.verify(token, secret) as JwtPayload
    req.teacher = payload
    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' })
  }
}
