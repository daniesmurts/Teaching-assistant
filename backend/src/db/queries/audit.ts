import { pool } from '../connection'
import { logger } from '../../lib/logger'
import type { AuditFilters } from '../../../../shared/types'

export interface AuditRow {
  id:               string
  institution_id:   string | null
  actor_teacher_id: string | null
  actor_email:      string | null
  action:           string
  target:           string | null
  metadata:         Record<string, unknown> | null
  ip_address:       string | null
  user_agent:       string | null
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
  ipAddress?: string | null
  userAgent?: string | null
}): void {
  pool.query(
    `INSERT INTO audit_log
       (institution_id, actor_teacher_id, actor_email, action, target, metadata, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.institutionId ?? null,
      entry.actorTeacherId ?? null,
      entry.actorEmail ?? null,
      entry.action,
      entry.target ?? null,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
      entry.ipAddress ?? null,
      entry.userAgent ?? null,
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

// ─── Platform-admin cross-institution view ──────────────────────────────────────

/**
 * Filterable, paginated listing across every institution. Backs the platform
 * admin activity view. Returns the page of rows plus the total match count so
 * the UI can paginate. All filters are optional and combine with AND.
 */
export async function listAudit(filters: AuditFilters): Promise<{ rows: AuditRow[]; total: number }> {
  const clauses: string[] = []
  const params: unknown[] = []

  const add = (sql: string, value: unknown) => {
    params.push(value)
    clauses.push(sql.replace('$?', `$${params.length}`))
  }

  if (filters.institutionId)  add('institution_id = $?',   filters.institutionId)
  if (filters.actorTeacherId) add('actor_teacher_id = $?', filters.actorTeacherId)
  if (filters.action)         add('action = $?',           filters.action)
  if (filters.from)           add('created_at >= $?',      filters.from)
  if (filters.to)             add('created_at <= $?',      filters.to)

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''

  const limit  = Math.min(Math.max(filters.limit ?? 100, 1), 500)
  const offset = Math.max(filters.offset ?? 0, 0)

  const { rows: countRows } = await pool.query<{ count: string }>(
    `SELECT COUNT(*)::int AS count FROM audit_log ${where}`,
    params
  )
  const total = Number(countRows[0]?.count ?? 0)

  const { rows } = await pool.query<AuditRow>(
    `SELECT * FROM audit_log ${where}
     ORDER BY created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  )

  return { rows, total }
}
