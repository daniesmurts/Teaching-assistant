import jwt from 'jsonwebtoken'
import { UnauthorizedError } from '../errors/AppError'

const ALGORITHM: jwt.Algorithm = 'HS256'
const ISSUER  = 'gradeassist'
const EXPIRY  = '7d'

function secret(): string {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set')
  return s
}

export interface TokenPayload {
  id:    string
  email: string
  iat:   number
  exp:   number
}

export function signToken(payload: { id: string; email: string }): string {
  return jwt.sign(payload, secret(), {
    expiresIn: EXPIRY,
    algorithm: ALGORITHM,
    issuer:    ISSUER,
  })
}

export function verifyToken(token: string): TokenPayload {
  try {
    return jwt.verify(token, secret(), {
      algorithms: [ALGORITHM],
      issuer:     ISSUER,
    }) as TokenPayload
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      throw new UnauthorizedError('Сессия истекла. Пожалуйста, войдите снова.')
    }
    throw new UnauthorizedError('Недействительная сессия. Пожалуйста, войдите снова.')
  }
}
