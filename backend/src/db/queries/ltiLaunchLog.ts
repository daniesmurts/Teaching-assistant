import { pool } from '../connection'

export interface LtiLaunchLogRow {
  id:             string
  institution_id: string
  teacher_id:     string | null
  message_type:   string | null
  role:           string | null
  context_title:  string | null
  success:        boolean
  error_code:     string | null
  created_at:     Date
}

export interface LtiLaunchLogWithTeacher extends LtiLaunchLogRow {
  teacher_name:  string | null
  teacher_email: string | null
}

/**
 * Fire-and-forget from routes/lti.ts's POST /launch — the caller wraps this
 * in `.catch(() => {})`. A logging failure must never break a real launch.
 */
export async function logLtiLaunch(params: {
  institutionId: string
  teacherId?:    string | null
  messageType?:  string | null
  role?:         string | null
  contextTitle?: string | null
  success:       boolean
  errorCode?:    string | null
}): Promise<void> {
  await pool.query(
    `INSERT INTO lti_launch_log
       (institution_id, teacher_id, message_type, role, context_title, success, error_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      params.institutionId,
      params.teacherId    ?? null,
      params.messageType  ?? null,
      params.role         ?? null,
      params.contextTitle ?? null,
      params.success,
      params.errorCode    ?? null,
    ]
  )
}

/** For InstitutionLti.tsx's activity-log section — most recent launches
 *  first, joined with teacher display fields. */
export async function listRecentLtiLaunches(
  institutionId: string,
  limit = 100
): Promise<LtiLaunchLogWithTeacher[]> {
  const { rows } = await pool.query<LtiLaunchLogWithTeacher>(
    `SELECT l.*, t.name AS teacher_name, t.email AS teacher_email
       FROM lti_launch_log l
       LEFT JOIN teachers t ON t.id = l.teacher_id
      WHERE l.institution_id = $1
      ORDER BY l.created_at DESC
      LIMIT $2`,
    [institutionId, Math.min(limit, 200)]
  )
  return rows
}
