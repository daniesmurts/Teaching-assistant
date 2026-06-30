import axios from 'axios'
import nodemailer from 'nodemailer'
import { logger } from '../lib/logger'

export interface EmailPayload {
  to:        string
  subject:   string
  html:      string
  text:      string
  /** 'security' skips List-Unsubscribe headers — password reset / password
   *  changed are security-critical transactional mail that mustn't carry an
   *  unsubscribe signal. Everything else (invites, welcome, admin notifications,
   *  feedback acks) gets the headers as a sender-reputation signal. */
  category?: 'security' | 'transactional'
}

// Sender identity — from_email's domain must be a VERIFIED sending domain in
// Unisender Go (DKIM/SPF), otherwise sends are rejected.
const FROM_EMAIL = process.env.EMAIL_FROM      ?? 'noreply@ispum.ru'
const FROM_NAME  = process.env.EMAIL_FROM_NAME ?? 'ИСПУМ'

// Reply-To — a real monitored address. Replies to noreply@ go to a void; mail
// clients and spam classifiers both penalise that pattern. Override per-env
// via EMAIL_REPLY_TO.
const REPLY_TO   = process.env.EMAIL_REPLY_TO  ?? 'support@ispum.ru'

// List-Unsubscribe mailto. Real one-click endpoint can come later; what
// matters for inbox placement today is the header existing and pointing
// somewhere parseable.
const UNSUB_MAILTO = process.env.EMAIL_UNSUBSCRIBE_MAILTO ?? 'unsubscribe@ispum.ru'

/** Headers added to every non-security email. Gmail/Yahoo's Feb-2024 sender
 *  rules made these the de-facto requirement for inbox placement; including
 *  them on transactional mail too is harmless and signals legitimacy. */
function reputationHeaders(payload: EmailPayload): Record<string, string> {
  const headers: Record<string, string> = {}
  if (payload.category !== 'security') {
    headers['List-Unsubscribe']      = `<mailto:${UNSUB_MAILTO}?subject=unsubscribe>`
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click'
  }
  return headers
}

// Where owner notifications (signups, purchases) go. Null → notifications off.
export function adminNotifyTo(): string | null {
  return process.env.ADMIN_NOTIFY_EMAIL?.trim() || null
}

// ─── Unisender Go (transactional HTTP API) ────────────────────────────────────

// Unisender Go runs several clusters — an account lives on exactly one. Ours is
// go2; override via UNISENDER_ENDPOINT if the account is moved/on another cluster.
const UNISENDER_ENDPOINT =
  process.env.UNISENDER_ENDPOINT ?? 'https://go2.unisender.ru/ru/transactional/api/v1/email/send.json'

async function sendViaUnisenderResult(apiKey: string, payload: EmailPayload): Promise<SendResult> {
  const res = await axios.post(
    UNISENDER_ENDPOINT,
    {
      message: {
        recipients:  [{ email: payload.to }],
        subject:     payload.subject,
        body:        { html: payload.html, plaintext: payload.text },
        from_email:  FROM_EMAIL,
        from_name:   FROM_NAME,
        reply_to:    REPLY_TO,
        headers:     reputationHeaders(payload),
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
    // Short, user-displayable reason. The free-tier domain-whitelist 403
    // (code 903) is the realistic recurring case — surface that verbatim so the
    // admin recognises it; otherwise fall back to a generic shape.
    const reason = data?.message
      ? `Unisender ${res.status}: ${data.message}`
      : `Unisender HTTP ${res.status}`
    return { ok: false, error: reason }
  }
  return { ok: true }
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

// ─── Send — never throws; returns the outcome so callers that care (e.g. the
// invite admin panel) can record delivery status. Existing fire-and-forget
// callers ignore the return naturally. ──────────────────────────────────────

export interface SendResult {
  ok:        boolean
  error?:    string    // short human-readable reason — safe to display
}

export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  try {
    // Preferred path: Unisender Go API
    const unisenderKey = process.env.UNISENDER_API_KEY
    if (unisenderKey) {
      const { ok, error } = await sendViaUnisenderResult(unisenderKey, payload)
      if (ok) logger.info({ message: 'Email sent', via: 'unisender', to: payload.to, subject: payload.subject })
      return { ok, error }
    }

    // Fallback: classic SMTP
    const transporter = getTransporter()
    if (transporter) {
      await transporter.sendMail({
        from:    `"${FROM_NAME}" <${process.env.SMTP_USER ?? FROM_EMAIL}>`,
        to:      payload.to,
        replyTo: REPLY_TO,
        subject: payload.subject,
        html:    payload.html,
        text:    payload.text,
        headers: reputationHeaders(payload),
      })
      logger.info({ message: 'Email sent', via: 'smtp', to: payload.to, subject: payload.subject })
      return { ok: true }
    }

    // Nothing configured — dev convenience: print to console
    if (process.env.NODE_ENV !== 'production') {
      logger.info({
        message: '[EMAIL] No provider configured — printing to console',
        to:      payload.to,
        subject: payload.subject,
        text:    payload.text,
      })
      return { ok: true }    // treat dev console as a success — no user-visible failure
    }
    return { ok: false, error: 'email provider not configured' }
  } catch (err) {
    const msg = (err as Error).message
    logger.error({ message: 'Email send failed', to: payload.to, error: msg })
    return { ok: false, error: msg }
  }
}
