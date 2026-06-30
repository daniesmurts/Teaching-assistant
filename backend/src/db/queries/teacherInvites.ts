import { pool } from '../connection'

export interface TeacherInviteRow {
  id:               string
  institution_id:   string
  invited_by:       string
  email:            string
  token:            string
  accepted:         boolean
  expires_at:       string
  created_at:       string
  // Tri-state — see migration 048. NULL = pre-migration row (unknown).
  email_delivered:  boolean | null
  email_error:      string  | null
}

export async function createInvite(data: {
  institutionId: string
  invitedBy:     string
  email:         string
  token:         string
  expiresAt:     Date
}): Promise<TeacherInviteRow> {
  const { rows } = await pool.query<TeacherInviteRow>(
    `INSERT INTO teacher_invites (institution_id, invited_by, email, token, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [data.institutionId, data.invitedBy, data.email.toLowerCase(), data.token, data.expiresAt]
  )
  return rows[0]
}

// A token is usable only if it exists, isn't accepted, and hasn't expired.
export async function findValidInviteByToken(token: string): Promise<TeacherInviteRow | null> {
  const { rows } = await pool.query<TeacherInviteRow>(
    `SELECT * FROM teacher_invites
     WHERE token = $1 AND accepted = FALSE AND expires_at > NOW()`,
    [token]
  )
  return rows[0] ?? null
}

export async function markInviteAccepted(id: string): Promise<void> {
  await pool.query(`UPDATE teacher_invites SET accepted = TRUE WHERE id = $1`, [id])
}

/** Record whether the invite email was actually delivered. Called after the
 *  send completes — fire-and-forget from the caller's perspective, never lets a
 *  DB error mask the original send-result the caller already returned. */
export async function markInviteEmailStatus(id: string, ok: boolean, error: string | null): Promise<void> {
  try {
    await pool.query(
      `UPDATE teacher_invites SET email_delivered = $2, email_error = $3 WHERE id = $1`,
      [id, ok, error]
    )
  } catch { /* ignore — logging is fine, but a DB blip here shouldn't crash the request */ }
}

// Pending = not accepted and not expired. Scoped to the institution.
export async function listPendingInvites(institutionId: string): Promise<TeacherInviteRow[]> {
  const { rows } = await pool.query<TeacherInviteRow>(
    `SELECT * FROM teacher_invites
     WHERE institution_id = $1 AND accepted = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC`,
    [institutionId]
  )
  return rows
}

export async function deleteInvite(id: string, institutionId: string): Promise<boolean> {
  const { rowCount } = await pool.query(
    `DELETE FROM teacher_invites WHERE id = $1 AND institution_id = $2`,
    [id, institutionId]
  )
  return (rowCount ?? 0) > 0
}

// Prevent duplicate active invites to the same address for the same institution.
export async function findActiveInviteForEmail(
  institutionId: string,
  email: string
): Promise<TeacherInviteRow | null> {
  const { rows } = await pool.query<TeacherInviteRow>(
    `SELECT * FROM teacher_invites
     WHERE institution_id = $1 AND email = $2 AND accepted = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [institutionId, email.toLowerCase()]
  )
  return rows[0] ?? null
}
