// Activation nudge sweep — the email counterpart of OnboardingChecklist.tsx.
// Hourly, worker 0 only (same PM2 gate as renewals.ts). Two-step ladder for
// teachers who registered but never reached the aha moment (first grade):
//   activation_24h — 24–72h after signup: "проверьте первую работу за 2 минуты"
//   activation_72h — 72h–7d after signup: the first-steps video, different angle
// Idempotent via activation_nudges claim-before-send; respects
// teachers.nudge_emails_enabled (unsubscribe link in every email).

import crypto from 'crypto'
import { config } from '../lib/config'
import { logger } from '../lib/logger'
import { sendEmail } from './emailTransport'
import { activation24hEmail, activation72hEmail } from '../lib/emailTemplates'
import {
  findNudgeCandidates, claimNudge, releaseNudgeClaim,
} from '../db/queries/activation'
import type { EmailPayload } from './emailTransport'

// ─── Unsubscribe token ────────────────────────────────────────────────────────
// HMAC over the teacher id with the JWT secret — stateless, never expires
// (an unsubscribe link in a week-old email must still work), and not guessable
// without the secret. Verified by GET /api/auth/nudge-unsubscribe.

export function nudgeUnsubToken(teacherId: string): string {
  const sig = crypto.createHmac('sha256', config.auth.jwtSecret).update(`nudge-unsub:${teacherId}`).digest('hex')
  return `${teacherId}.${sig}`
}

export function verifyNudgeUnsubToken(token: string): string | null {
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return null
  const teacherId = token.slice(0, dot)
  const sig       = token.slice(dot + 1)
  const expected  = crypto.createHmac('sha256', config.auth.jwtSecret).update(`nudge-unsub:${teacherId}`).digest('hex')
  if (sig.length !== expected.length) return null
  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) ? teacherId : null
}

function unsubUrl(teacherId: string): string {
  return `${config.frontendUrl}/api/auth/nudge-unsubscribe?token=${nudgeUnsubToken(teacherId)}`
}

// ─── The sweep ────────────────────────────────────────────────────────────────

interface NudgeRule {
  type:        'activation_24h' | 'activation_72h'
  minAgeHours: number
  maxAgeHours: number
  template:    (name: string, unsub: string) => Omit<EmailPayload, 'to'>
}

const RULES: NudgeRule[] = [
  { type: 'activation_24h', minAgeHours: 24, maxAgeHours: 72,      template: activation24hEmail },
  { type: 'activation_72h', minAgeHours: 72, maxAgeHours: 7 * 24,  template: activation72hEmail },
]

export async function runActivationSweep(): Promise<void> {
  for (const rule of RULES) {
    let candidates
    try {
      candidates = await findNudgeCandidates(rule.type, rule.minAgeHours, rule.maxAgeHours)
    } catch (err) {
      logger.error({ message: 'Activation sweep query failed', nudgeType: rule.type, error: (err as Error).message })
      continue
    }

    for (const teacher of candidates) {
      // Claim first — if the row already exists (concurrent run, crash between
      // send and record on a previous pass) we skip rather than double-send.
      if (!(await claimNudge(teacher.id, rule.type).catch(() => false))) continue

      const payload = rule.template(teacher.name ?? '', unsubUrl(teacher.id))
      const result = await sendEmail({ ...payload, to: teacher.email, category: 'transactional' })
        .catch((err) => ({ ok: false as const, error: (err as Error).message }))

      if (result.ok) {
        logger.info({ message: 'Activation nudge sent', nudgeType: rule.type, teacherId: teacher.id })
      } else {
        // Release the claim so the next hourly run retries while the teacher
        // is still inside the rule's age window.
        await releaseNudgeClaim(teacher.id, rule.type).catch(() => null)
        logger.warn({ message: 'Activation nudge send failed', nudgeType: rule.type, teacherId: teacher.id })
      }
    }
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

export function startActivationScheduler(): void {
  // Same worker-0 gate as the payment schedulers — PM2 cluster mode would
  // otherwise run the sweep once per worker.
  const instanceId = process.env.NODE_APP_INSTANCE ?? '0'
  if (instanceId !== '0') return

  const HOUR = 60 * 60 * 1000
  setTimeout(() => { void runActivationSweep() }, 2 * 60_000)  // first run 2 min after boot
  setInterval(() => { void runActivationSweep() }, HOUR)
  logger.info({ message: 'Activation nudge scheduler started (hourly)' })
}
