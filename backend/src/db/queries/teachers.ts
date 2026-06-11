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
  rebill_id:           string | null
  auto_renew:          boolean
  subscription_plan:   string | null
  renewal_failed_at:   Date | null
  institution_plan_tier: string | null   // tier of the teacher's institution (if any)
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
    `SELECT t.*, i.plan_tier AS institution_plan_tier
       FROM teachers t
       LEFT JOIN institutions i ON i.id = t.institution_id
      WHERE t.id = $1 LIMIT 1`,
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

/** Immediately revoke Pro — downgrade to free and clear all subscription state. */
export async function cancelTeacherSubscription(teacherId: string): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET plan_tier         = 'free',
         plan_expires_at   = NOW(),
         subscription_id   = NULL,
         auto_renew        = FALSE,
         rebill_id         = NULL,
         subscription_plan = NULL,
         renewal_failed_at = NULL
     WHERE id = $1`,
    [teacherId]
  )
}

/**
 * Permanently delete a teacher and all associated data (152-ФЗ right to erasure).
 * FK cascades remove courses, criteria, assignments, presentations, documents,
 * chunks, payments, usage counters, reset tokens; api_usage_log is anonymised
 * (teacher_id → NULL, no PII in that table).
 */
export async function deleteTeacher(teacherId: string): Promise<void> {
  await pool.query('DELETE FROM teachers WHERE id = $1', [teacherId])
}

// ─── Recurring subscription state ─────────────────────────────────────────────

/** Store the saved-card token + plan and enable auto-renewal (after first payment). */
export async function setRecurringInfo(
  teacherId: string,
  rebillId: string,
  plan: string
): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET rebill_id = $2, subscription_plan = $3, auto_renew = TRUE, renewal_failed_at = NULL
     WHERE id = $1`,
    [teacherId, rebillId, plan]
  )
}

export async function setAutoRenew(teacherId: string, enabled: boolean): Promise<void> {
  await pool.query('UPDATE teachers SET auto_renew = $2 WHERE id = $1', [teacherId, enabled])
}

export interface RenewalCandidate {
  id:                string
  email:             string
  name:              string | null
  rebill_id:         string
  subscription_plan: string
  plan_expires_at:   Date
  renewal_failed_at: Date | null
}

/** Teachers whose subscription is due to renew within ~1 day (or already in grace). */
export async function findTeachersDueForRenewal(): Promise<RenewalCandidate[]> {
  const { rows } = await pool.query<RenewalCandidate>(
    `SELECT id, email, name, rebill_id, subscription_plan, plan_expires_at, renewal_failed_at
     FROM teachers
     WHERE auto_renew = TRUE
       AND rebill_id IS NOT NULL
       AND subscription_plan IS NOT NULL
       AND (plan_expires_at <= NOW() + INTERVAL '1 day'   -- due soon
            OR renewal_failed_at IS NOT NULL)              -- or in grace (retry daily)
       -- throttle: never attempt the same teacher more than once per ~20h,
       -- so PM2 restarts can't cause repeat charges / email spam
       AND (renewal_last_attempt_at IS NULL
            OR renewal_last_attempt_at < NOW() - INTERVAL '20 hours')`
  )
  return rows
}

/** Stamp a renewal attempt (called before each charge) — drives the throttle. */
export async function markRenewalAttempted(teacherId: string): Promise<void> {
  await pool.query('UPDATE teachers SET renewal_last_attempt_at = NOW() WHERE id = $1', [teacherId])
}

/** Successful renewal — extend the period and clear any failure flag. */
export async function applyRenewalSuccess(teacherId: string, days: number): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET plan_tier       = 'pro',
         plan_expires_at  = GREATEST(COALESCE(plan_expires_at, NOW()), NOW()) + ($2 || ' days')::interval,
         renewal_failed_at = NULL
     WHERE id = $1`,
    [teacherId, days]
  )
}

/** First renewal failure — enter the grace window (keep access until grace ends). */
export async function enterRenewalGrace(teacherId: string, graceDays: number): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET renewal_failed_at = NOW(),
         plan_expires_at   = NOW() + ($2 || ' days')::interval
     WHERE id = $1`,
    [teacherId, graceDays]
  )
}

/** Grace exhausted — downgrade to free and clear subscription state. */
export async function endSubscriptionAfterGrace(teacherId: string): Promise<void> {
  await pool.query(
    `UPDATE teachers
     SET plan_tier         = 'free',
         plan_expires_at   = NOW(),
         auto_renew        = FALSE,
         rebill_id         = NULL,
         subscription_plan = NULL,
         renewal_failed_at = NULL
     WHERE id = $1`,
    [teacherId]
  )
}

export async function createTeacher(
  email: string,
  passwordHash: string,
  name?: string,
  university?: string,
  phone?: string,
  institutionId?: string,   // set when registering via an institution invite
): Promise<Teacher> {
  const { rows } = await pool.query<TeacherRow>(
    `INSERT INTO teachers (email, password_hash, name, university, phone, institution_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [email.toLowerCase(), passwordHash, name ?? null, university ?? null, phone ?? null, institutionId ?? null]
  )
  return toTeacher(rows[0])
}
