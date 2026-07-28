import jwt from 'jsonwebtoken'
import { randomBytes } from 'crypto'
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
  dks:   string
  iat:   number
  exp:   number
}

// dks ("draft key seed") is a random per-login value, unrelated to the
// session secret itself — the frontend can't read the HttpOnly cookie, so
// this rides along in the JWT payload (returned in the login/register/me
// JSON body) purely to key local AES-GCM encryption of drafts (see
// frontend/src/lib/draftCrypto.ts). It rotates on every login exactly like
// the old scheme (SHA-256 of the raw token) did, but on its own it grants no
// API access.
export function signToken(payload: { id: string; email: string }): { token: string; draftKeySeed: string } {
  const draftKeySeed = randomBytes(16).toString('hex')
  const token = jwt.sign({ ...payload, dks: draftKeySeed }, secret(), {
    expiresIn: EXPIRY,
    algorithm: ALGORITHM,
    issuer:    ISSUER,
  })
  return { token, draftKeySeed }
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
