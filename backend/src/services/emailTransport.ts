import axios from 'axios'
import nodemailer from 'nodemailer'
import { logger } from '../lib/logger'

export interface EmailPayload {
  to:      string
  subject: string
  html:    string
  text:    string
}

// Sender identity — from_email's domain must be a VERIFIED sending domain in
// Unisender Go (DKIM/SPF), otherwise sends are rejected.
const FROM_EMAIL = process.env.EMAIL_FROM      ?? 'noreply@ispum.ru'
const FROM_NAME  = process.env.EMAIL_FROM_NAME ?? 'ИСПУМ'

// Where owner notifications (signups, purchases) go. Null → notifications off.
export function adminNotifyTo(): string | null {
  return process.env.ADMIN_NOTIFY_EMAIL?.trim() || null
}

// ─── Unisender Go (transactional HTTP API) ────────────────────────────────────

// Unisender Go runs several clusters — an account lives on exactly one. Ours is
// go2; override via UNISENDER_ENDPOINT if the account is moved/on another cluster.
const UNISENDER_ENDPOINT =
  process.env.UNISENDER_ENDPOINT ?? 'https://go2.unisender.ru/ru/transactional/api/v1/email/send.json'

async function sendViaUnisender(apiKey: string, payload: EmailPayload): Promise<boolean> {
  const res = await axios.post(
    UNISENDER_ENDPOINT,
    {
      message: {
        recipients:  [{ email: payload.to }],
        subject:     payload.subject,
        body:        { html: payload.html, plaintext: payload.text },
        from_email:  FROM_EMAIL,
        from_name:   FROM_NAME,
      },
    },
    {
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      timeout: 15_000,
      validateStatus: () => true,   // inspect the body ourselves
    }
  )

  const data = res.data as { status?: string; failed_emails?: unknown; message?: string; code?: number }
  const ok = res.status >= 200 && res.status < 300 && data?.status === 'success'
  if (!ok) {
    logger.error({
      message:    'Unisender send failed',
      to:         payload.to,
      httpStatus: res.status,
      apiStatus:  data?.status,
      apiCode:    data?.code,
      apiMessage: data?.message,
      failed:     data?.failed_emails,
    })
  }
  return ok
}

// ─── SMTP fallback (lazy — missing env doesn't crash startup) ─────────────────

let _transporter: nodemailer.Transporter | null = null

function getTransporter(): nodemailer.Transporter | null {
  if (_transporter) return _transporter
  const host = process.env.SMTP_HOST
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!host || !user || !pass) return null

  _transporter = nodemailer.createTransport({
    host,
    port:   Number(process.env.SMTP_PORT ?? 465),
    secure: true,
    auth:   { user, pass },
  })
  return _transporter
}

// ─── Send — always fire-and-forget, never throw to the caller ─────────────────

export async function sendEmail(payload: EmailPayload): Promise<void> {
  try {
    // Preferred path: Unisender Go API
    const unisenderKey = process.env.UNISENDER_API_KEY
    if (unisenderKey) {
      const ok = await sendViaUnisender(unisenderKey, payload)
      if (ok) logger.info({ message: 'Email sent', via: 'unisender', to: payload.to, subject: payload.subject })
      return
    }

    // Fallback: classic SMTP
    const transporter = getTransporter()
    if (transporter) {
      await transporter.sendMail({
        from:    `"${FROM_NAME}" <${process.env.SMTP_USER ?? FROM_EMAIL}>`,
        to:      payload.to,
        subject: payload.subject,
        html:    payload.html,
        text:    payload.text,
      })
      logger.info({ message: 'Email sent', via: 'smtp', to: payload.to, subject: payload.subject })
      return
    }

    // Nothing configured — dev convenience: print to console
    if (process.env.NODE_ENV !== 'production') {
      logger.info({
        message: '[EMAIL] No provider configured — printing to console',
        to:      payload.to,
        subject: payload.subject,
        text:    payload.text,
      })
    }
  } catch (err) {
    // Email failures must never surface to the user — log only
    logger.error({ message: 'Email send failed', to: payload.to, error: (err as Error).message })
  }
}
