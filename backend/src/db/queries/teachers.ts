import { pool } from '../connection'
import type { Teacher } from '../../../../shared/types'

// ─── Row shape (includes password_hash, not exposed in shared Teacher type) ───

export interface TeacherRow {
  id: string
  email: string
  password_hash: string
  name: string | null
  university: string | null
  created_at: Date
}

function toTeacher(row: TeacherRow): Teacher {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    university: row.university,
    created_at: row.created_at.toISOString(),
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function findTeacherByEmail(
  email: string
): Promise<TeacherRow | null> {
  const { rows } = await pool.query<TeacherRow>(
    'SELECT * FROM teachers WHERE email = $1 LIMIT 1',
    [email.toLowerCase()]
  )
  return rows[0] ?? null
}

export async function findTeacherById(id: string): Promise<Teacher | null> {
  const { rows } = await pool.query<TeacherRow>(
    'SELECT * FROM teachers WHERE id = $1 LIMIT 1',
    [id]
  )
  return rows[0] ? toTeacher(rows[0]) : null
}

export async function createTeacher(
  email: string,
  passwordHash: string,
  name?: string,
  university?: string
): Promise<Teacher> {
  const { rows } = await pool.query<TeacherRow>(
    `INSERT INTO teachers (email, password_hash, name, university)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, name ?? null, university ?? null]
  )
  return toTeacher(rows[0])
}
