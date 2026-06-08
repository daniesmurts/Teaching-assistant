import { pool } from '../connection'
import { logger } from '../../lib/logger'

export interface AuditRow {
  id:               string
  institution_id:   string | null
  actor_teacher_id: string | null
  actor_email:      string | null
  action:           string
  target:           string | null
  metadata:         Record<string, unknown> | null
  created_at:       string
}

/** Fire-and-forget — auditing must never break the action it records. */
export function recordAudit(entry: {
  institutionId?: string | null
  actorTeacherId?: string | null
  actorEmail?: string | null
  action: string
  target?: string | null
  metadata?: Record<string, unknown>
}): void {
  pool.query(
    `INSERT INTO audit_log (institution_id, actor_teacher_id, actor_email, action, target, metadata)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      entry.institutionId ?? null,
      entry.actorTeacherId ?? null,
      entry.actorEmail ?? null,
      entry.action,
      entry.target ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ]
  ).catch((e) => logger.warn({ message: 'Audit write failed', action: entry.action, error: e.message }))
}

export async function listAuditByInstitution(institutionId: string, limit = 100): Promise<AuditRow[]> {
  const { rows } = await pool.query<AuditRow>(
    `SELECT * FROM audit_log WHERE institution_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [institutionId, Math.min(limit, 500)]
  )
  return rows
}
