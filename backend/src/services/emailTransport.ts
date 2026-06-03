import nodemailer from 'nodemailer'
import { logger } from '../lib/logger'

export interface EmailPayload {
  to:      string
  subject: string
  html:    string
  text:    string
}

// ─── Transporter (lazy-initialised so missing SMTP env doesn't crash startup) ─

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
    auth: { user, pass },
  })

  return _transporter
}

// ─── Send — always fire-and-forget, never throw to the caller ─────────────────

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const transporter = getTransporter()

  if (!transporter) {
    // Dev fallback: log to console when SMTP is not configured
    if (process.env.NODE_ENV !== 'production') {
      logger.info({
        message: '[EMAIL] SMTP not configured — printing to console',
        to:      payload.to,
        subject: payload.subject,
        text:    payload.text,
      })
    }
    return
  }

  try {
    await transporter.sendMail({
      from:    `"ИСПУМ" <${process.env.SMTP_USER}>`,
      to:      payload.to,
      subject: payload.subject,
      html:    payload.html,
      text:    payload.text,
    })
    logger.info({ message: 'Email sent', to: payload.to, subject: payload.subject })
  } catch (err) {
    // Never surface email failures to the user — log only
    logger.error({
      message: 'Email send failed',
      to:      payload.to,
      error:   (err as Error).message,
    })
  }
}
