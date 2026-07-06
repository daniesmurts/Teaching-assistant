import { pool } from '../connection'

export interface ContactMessageRow {
  id:           string
  name:         string
  email:        string
  organization: string | null
  topic:        string
  message:      string
  source_page:  string
  status:       string
  created_at:   string
}

export async function createContactMessage(data: {
  name:         string
  email:        string
  organization?: string | null
  topic:        string
  message:      string
  sourcePage:   string
}): Promise<ContactMessageRow> {
  const { rows } = await pool.query<ContactMessageRow>(
    `INSERT INTO contact_messages (name, email, organization, topic, message, source_page)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [data.name, data.email, data.organization ?? null, data.topic, data.message, data.sourcePage]
  )
  return rows[0]
}

export async function listContactMessages(limit = 200): Promise<ContactMessageRow[]> {
  const { rows } = await pool.query<ContactMessageRow>(
    `SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT $1`,
    [Math.min(limit, 500)]
  )
  return rows
}

export async function markContactMessageRead(id: string): Promise<ContactMessageRow | null> {
  const { rows } = await pool.query<ContactMessageRow>(
    `UPDATE contact_messages SET status = 'read' WHERE id = $1 RETURNING *`,
    [id]
  )
  return rows[0] ?? null
}
