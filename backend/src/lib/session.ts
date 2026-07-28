import type { Response } from 'express'

export const SESSION_COOKIE_NAME = 'ispum_session'

const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // matches jwt.ts EXPIRY

function cookieOptions() {
  return {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path:     '/',
  }
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE_NAME, token, { ...cookieOptions(), maxAge: MAX_AGE_MS })
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, cookieOptions())
}
