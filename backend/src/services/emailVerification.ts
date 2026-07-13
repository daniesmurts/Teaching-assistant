// Email-ownership verification for self-registered accounts. Same
// stateless-HMAC pattern as activation.ts (nudge-unsub) and
// marketingEmails.ts — distinct salt string keeps the three token namespaces
// from being interchangeable. Unlike those two, the MAC also covers the
// email address: a verification link proves ownership of a *specific*
// address, so if the account's email ever changes, links sent to the old
// address must stop working. Never expires otherwise — a teacher digging the
// welcome email out of their inbox a month later should still be able to
// verify.
//
// The token carries only the teacher id in the clear (`id.sig`); the route
// extracts the id, loads the row, and re-computes the MAC with the row's
// CURRENT email.

import crypto from 'crypto'
import { config } from '../lib/config'

function sign(teacherId: string, email: string): string {
  return crypto.createHmac('sha256', config.auth.jwtSecret)
    .update(`email-verify:${teacherId}:${email.toLowerCase()}`)
    .digest('hex')
}

export function emailVerifyToken(teacherId: string, email: string): string {
  return `${teacherId}.${sign(teacherId, email)}`
}

/** The teacher id a token claims to be for — NOT yet authenticated. The
 *  caller loads that row and passes its current email to verify below. */
export function extractTeacherIdFromVerifyToken(token: string): string | null {
  const dot = token.lastIndexOf('.')
  return dot > 0 ? token.slice(0, dot) : null
}

export function verifyEmailVerifyToken(token: string, currentEmail: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const teacherId = token.slice(0, dot)
  const sig       = token.slice(dot + 1)
  const expected  = sign(teacherId, currentEmail)
  if (sig.length !== expected.length) return null
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? teacherId : null
}

// Links to the GET confirm page — the mutation happens on the POST that
// page's button submits (mail-scanner prefetch safety; and here the scanner
// concern is sharper than for unsubscribe: an auto-GET-verify would let a
// scanner "confirm" an account the mailbox owner never registered, which is
// exactly the pre-hijack window verification exists to close).
export function emailVerifyUrl(teacherId: string, email: string): string {
  return `${config.frontendUrl}/api/auth/verify-email?token=${emailVerifyToken(teacherId, email)}`
}
