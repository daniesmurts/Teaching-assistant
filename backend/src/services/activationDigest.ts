// Weekly activation digest → Telegram. One message every Monday morning with
// the founder-level numbers: signups, activations (first grade), stalled
// users, nudges sent. Reuses the incident-alert bot/chat — one inbox.

import { pool } from '../db/connection'
import { logger } from '../lib/logger'
import { runWithLease } from './schedulerLease'
import { sendTelegramMessage } from '../lib/telegramAlert'
import { getStalledTeachers } from '../db/queries/activation'

interface WeekStats {
  signups:        number
  activated:      number   // teachers whose FIRST grade happened this week
  nudges_24h:     number
  nudges_72h:     number
}

async function weekStats(): Promise<WeekStats> {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM teachers
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND COALESCE(is_platform_admin, FALSE) = FALSE)                    AS signups,
       (SELECT COUNT(*)::int FROM (
          SELECT teacher_id, MIN(created_at) AS first_grade_at
            FROM assignments GROUP BY teacher_id
        ) f WHERE f.first_grade_at >= NOW() - INTERVAL '7 days')              AS activated,
       (SELECT COUNT(*)::int FROM activation_nudges
         WHERE nudge_type = 'activation_24h'
           AND sent_at >= NOW() - INTERVAL '7 days')                          AS nudges_24h,
       (SELECT COUNT(*)::int FROM activation_nudges
         WHERE nudge_type = 'activation_72h'
           AND sent_at >= NOW() - INTERVAL '7 days')                          AS nudges_72h`
  )
  return rows[0]
}

export async function sendActivationDigest(): Promise<void> {
  try {
    const [stats, stalled] = await Promise.all([weekStats(), getStalledTeachers(500)])
    const stalledThisWeek = stalled.filter(
      (t) => new Date(t.created_at).getTime() >= Date.now() - 7 * 24 * 60 * 60 * 1000
    )

    const text = [
      `📊 ИСПУМ — активация за неделю`,
      `Регистраций: ${stats.signups}`,
      `Активировались (первая проверка): ${stats.activated}`,
      `Застряли (из новых за неделю): ${stalledThisWeek.length}`,
      `Всего застрявших без активации: ${stalled.length}`,
      `Отправлено подсказок: ${stats.nudges_24h} (24ч) + ${stats.nudges_72h} (72ч)`,
    ].join('\n')

    await sendTelegramMessage(text)
  } catch (err) {
    logger.error({ message: 'Activation digest failed', error: (err as Error).message })
  }
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
// Hourly tick that fires only in the Monday 08:00–08:59 (server time) window;
// activation_digest_sent tracking isn't needed — the tick runs once per hour,
// so the window matches exactly one tick per week.

export function startActivationDigestScheduler(): void {
  const HOUR = 60 * 60 * 1000
  // The lease is taken only when the send window actually matches, so an
  // idle hourly tick costs no database write. A 50-minute lease then covers
  // the single Monday-08:xx tick across every instance.
  const maybeSend = (): void => {
    const now = new Date()
    if (now.getDay() !== 1 || now.getHours() !== 8) return
    void runWithLease('activation_digest', 50 * 60_000, () => sendActivationDigest())
  }
  setInterval(maybeSend, HOUR)
  logger.info({ message: 'Activation digest scheduler started (Mondays 08:00)' })
}
