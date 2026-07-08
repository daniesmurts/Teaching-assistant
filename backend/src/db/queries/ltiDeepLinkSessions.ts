import { pool } from '../connection'

export interface LtiDeepLinkSessionRow {
  id:                   string
  institution_id:       string
  teacher_id:           string
  deployment_id:        string
  context_id:           string | null
  context_title:        string | null
  course_id:            string | null
  deep_link_return_url: string
  passthrough_data:     string | null
  created_at:           Date
}

const SESSION_TTL_MS = 15 * 60 * 1000

export async function createDeepLinkSession(params: {
  institutionId:      string
  teacherId:          string
  deploymentId:       string
  contextId:          string | null
  contextTitle:       string | null
  courseId:           string | null
  deepLinkReturnUrl:  string
  passthroughData:    string | null
}): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO lti_deep_link_sessions
       (institution_id, teacher_id, deployment_id, context_id, context_title,
        course_id, deep_link_return_url, passthrough_data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [params.institutionId, params.teacherId, params.deploymentId, params.contextId,
     params.contextTitle, params.courseId, params.deepLinkReturnUrl, params.passthroughData]
  )
  await pool.query(
    `DELETE FROM lti_deep_link_sessions WHERE created_at < NOW() - INTERVAL '${SESSION_TTL_MS / 1000} seconds'`
  )
  return rows[0].id
}

/** Scoped to the requesting teacher — a session belongs to whoever launched it. */
export async function getDeepLinkSession(
  id: string,
  teacherId: string
): Promise<LtiDeepLinkSessionRow | null> {
  const { rows } = await pool.query<LtiDeepLinkSessionRow>(
    `SELECT * FROM lti_deep_link_sessions WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
  const row = rows[0]
  if (!row) return null
  if (Date.now() - row.created_at.getTime() > SESSION_TTL_MS) return null
  return row
}

export async function consumeDeepLinkSession(id: string, teacherId: string): Promise<void> {
  await pool.query(
    `DELETE FROM lti_deep_link_sessions WHERE id = $1 AND teacher_id = $2`,
    [id, teacherId]
  )
}
