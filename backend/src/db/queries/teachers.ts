import { pool } from '../connection'
import type { Teacher } from '../../../../shared/types'

// ─── Full DB row (includes fields not in the public Teacher type) ─────────────

export interface TeacherRow {
  id:                  string
  email:               string
  password_hash:       string
  name:                string | null
  university:          string | null
  phone:               string | null
  role:                string
  institution_id:      string | null
  plan_tier:           string
  is_active:           boolean
  plan_started_at:     Date | null
  plan_expires_at:     Date | null
  subscription_id:     string | null
  password_changed_at: Date | null
  created_at:          Date
}

function toTeacher(row: TeacherRow): Teacher {
  return {
    id:          row.id,
    email:       row.email,
    name:        row.name,
    university:  row.university,
    phone:       row.phone,
    created_at:  row.created_at.toISOString(),
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function findTeacherByEmail(email: string): Promise<TeacherRow | null> {
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

/** Returns the full row (including role, plan_tier etc.) — used by authenticate middleware */
export async function findTeacherRowById(id: string): Promise<TeacherRow | null> {
  const { rows } = await pool.query<TeacherRow>(
    'SELECT * FROM teachers WHERE id = $1 LIMIT 1',
    [id]
  )
  return rows[0] ?? null
}

export async function updateTeacherPassword(
  id: string,
  passwordHash: string
): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET password_hash        = $2,
         password_changed_at  = NOW()
     WHERE id = $1`,
    [id, passwordHash]
  )
}

/**
 * Upgrade (or extend) a teacher's Pro subscription. If they still have time
 * left, the new period stacks on top of the existing expiry; otherwise it
 * starts now.
 */
export async function upgradeTeacherToPro(
  teacherId: string,
  days: number,
  subscriptionId: string
): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET plan_tier       = 'pro',
         plan_started_at  = COALESCE(plan_started_at, NOW()),
         plan_expires_at  = GREATEST(COALESCE(plan_expires_at, NOW()), NOW())
                            + ($2 || ' days')::interval,
         subscription_id  = $3
     WHERE id = $1`,
    [teacherId, days, subscriptionId]
  )
}

export async function createTeacher(
  email: string,
  passwordHash: string,
  name?: string,
  university?: string,
  phone?: string
): Promise<Teacher> {
  const { rows } = await pool.query<TeacherRow>(
    `INSERT INTO teachers (email, password_hash, name, university, phone)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, name ?? null, university ?? null, phone ?? null]
  )
  return toTeacher(rows[0])
}
