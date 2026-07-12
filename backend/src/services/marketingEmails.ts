// One-click unsubscribe for one-off feature-announcement broadcasts sent
// manually through an external tool (e.g. Yandex mail-merge), not through
// emailTransport.ts. Same stateless-HMAC pattern as activation.ts's
// nudge-unsubscribe token — a distinct salt string keeps the two token
// namespaces from being interchangeable — but gates a separate
// teachers.marketing_emails_enabled flag, since "skip onboarding tips" and
// "skip feature announcements" are different opt-outs.

import crypto from 'crypto'
import { config } from '../lib/config'

export function marketingUnsubToken(teacherId: string): string {
  const sig = crypto.createHmac('sha256', config.auth.jwtSecret).update(`marketing-unsub:${teacherId}`).digest('hex')
  return `${teacherId}.${sig}`
}

export function verifyMarketingUnsubToken(token: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const teacherId = token.slice(0, dot)
  const sig       = token.slice(dot + 1)
  const expected  = crypto.createHmac('sha256', config.auth.jwtSecret).update(`marketing-unsub:${teacherId}`).digest('hex')
  if (sig.length !== expected.length) return null
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? teacherId : null
}

export function marketingUnsubUrl(teacherId: string): string {
  return `${config.frontendUrl}/api/auth/marketing-unsubscribe?token=${marketingUnsubToken(teacherId)}`
}
