import { pool } from '../connection'
import { logger } from '../../lib/logger'

/** Fire-and-forget — recording an incident must never break the request that triggered it. */
export function recordIncident(entry: {
  code: string
  message: string
  path?: string | null
  method?: string | null
  teacherId?: string | null
  stack?: string | null
  telegramSent: boolean
}): void {
  pool.query(
    `INSERT INTO production_incidents
       (code, message, path, method, teacher_id, stack, telegram_sent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      entry.code,
      entry.message,
      entry.path ?? null,
      entry.method ?? null,
      entry.teacherId ?? null,
      entry.stack ?? null,
      entry.telegramSent,
    ]
  ).catch((err) => {
    logger.error({ message: 'Failed to record production incident', error: (err as Error).message })
  })
}
