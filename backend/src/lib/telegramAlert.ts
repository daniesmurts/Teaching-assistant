import axios from 'axios'
import { config } from './config'
import { logger } from './logger'

// One production process (PM2 cluster mode runs a few workers) is enough to
// flood a chat if an error loops — e.g. a crash-restart cycle hitting the
// same code every few seconds. Dedup per code within a window instead of
// suppressing globally, so an unrelated second failure still gets through.
const ALERT_WINDOW_MS = 15 * 60 * 1000
const lastSentAt = new Map<string, number>()

function shouldSend(code: string): boolean {
  const last = lastSentAt.get(code)
  const now = Date.now()
  if (last && now - last < ALERT_WINDOW_MS) return false
  lastSentAt.set(code, now)
  return true
}

/** Raw send — no dedup window. Used by the incident alerter (below, deduped)
 *  and by scheduled digests that manage their own cadence. */
export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!config.telegram.botToken || !config.telegram.chatId) return false
  try {
    await axios.post(
      `https://api.telegram.org/bot${config.telegram.botToken}/sendMessage`,
      { chat_id: config.telegram.chatId, text },
      { timeout: 5_000 }
    )
    return true
  } catch (err) {
    logger.error({ message: 'Failed to send Telegram alert', error: (err as Error).message })
    return false
  }
}

/**
 * Fire-and-forget Telegram push for a production incident. Returns whether an
 * alert was actually sent (vs. suppressed by the dedup window or unconfigured)
 * so callers can record it on the incident row.
 */
export async function sendTelegramAlert(params: {
  code: string
  message: string
  path?: string | null
  method?: string | null
}): Promise<boolean> {
  if (!config.telegram.botToken || !config.telegram.chatId) return false
  if (!shouldSend(params.code)) return false

  const text = [
    `🔴 ИСПУМ — production error`,
    `code: ${params.code}`,
    params.method && params.path ? `route: ${params.method} ${params.path}` : null,
    `message: ${params.message}`,
  ].filter(Boolean).join('\n')

  return sendTelegramMessage(text)
}
