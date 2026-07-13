import bcrypt from 'bcryptjs'
import { randomBytes } from 'node:crypto'
import { pool } from '../connection'
import { assignDefaultDepartmentIfUnset } from './orgUnits'
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
  primary_org_unit_id: string | null   // §7 org tree — teacher's primary department
  is_platform_admin:   boolean         // §7 orthogonal platform-owner flag
  email_verified_at:   Date | null     // NULL = ownership of the address not yet proven
  institution_plan_tier:         string | null   // tier of the teacher's institution (if any)
  institution_shared_rag_enabled: boolean | null // mirror of institutions.shared_rag_enabled
  created_at:          Date
}

function toTeacher(row: TeacherRow): Teacher {
  return {
    id:             row.id,
    email:          row.email,
    name:           row.name,
    university:     row.university,
    phone:          row.phone,
    email_verified: row.email_verified_at != null,
    created_at:     row.created_at.toISOString(),
  }
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function findTeacherByEmail(email: string): Promise<TeacherRow | null> {
  // Join the institution so callers (login) can compute the effective tier
  // — including seat-based inheritance — exactly like findTeacherRowById.
  const { rows } = await pool.query<TeacherRow>(
    `SELECT t.*,
            i.plan_tier         AS institution_plan_tier,
            i.shared_rag_enabled AS institution_shared_rag_enabled
       FROM teachers t
       LEFT JOIN institutions i ON i.id = t.institution_id
      WHERE t.email = $1 LIMIT 1`,
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
    `SELECT t.*,
            i.plan_tier         AS institution_plan_tier,
            i.shared_rag_enabled AS institution_shared_rag_enabled
       FROM teachers t
       LEFT JOIN institutions i ON i.id = t.institution_id
      WHERE t.id = $1 LIMIT 1`,
    [id]
  )
  return rows[0] ?? null
}

// ─── last_seen_at touch (activation/retention tracking) ──────────────────────
// Called by authenticate on every request; the in-memory map keeps it to one
// DB write per teacher per 15 min per worker (2 PM2 workers → worst case two
// writes per window, fine). Fire-and-forget — activity tracking must never
// slow down or fail the request being authenticated.

const LAST_SEEN_THROTTLE_MS = 15 * 60 * 1000
const lastSeenTouchedAt = new Map<string, number>()

export function touchLastSeen(teacherId: string): void {
  const now = Date.now()
  const last = lastSeenTouchedAt.get(teacherId)
  if (last && now - last < LAST_SEEN_THROTTLE_MS) return
  lastSeenTouchedAt.set(teacherId, now)

  pool.query(
    `UPDATE teachers SET last_seen_at = NOW() WHERE id = $1`,
    [teacherId]
  ).catch(() => {
    // Forget the throttle entry so the next request retries the write.
    lastSeenTouchedAt.delete(teacherId)
  })
}

/** Update the teacher's display name. Used by the Settings page so a mistyped
 *  name at signup can be corrected without rebuilding the account. */
export async function updateTeacherName(teacherId: string, name: string): Promise<void> {
  await pool.query(
    `UPDATE teachers SET name = $2 WHERE id = $1`,
    [teacherId, name]
  )
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

// ─── Email verification (deferred — see migration 076) ───────────────────────

export async function setEmailVerified(teacherId: string): Promise<void> {
  await pool.query(
    `UPDATE teachers SET email_verified_at = COALESCE(email_verified_at, NOW()) WHERE id = $1`,
    [teacherId]
  )
}

// ─── One-off marketing broadcasts (feature announcements, sent externally) ────

export async function setMarketingEmailsEnabled(teacherId: string, enabled: boolean): Promise<void> {
  await pool.query(
    `UPDATE teachers SET marketing_emails_enabled = $2 WHERE id = $1`,
    [teacherId, enabled]
  )
}

/** Teachers eligible for a mail-merge broadcast — opted in, verified address
 *  (an unverified address may be a typo or someone else's; sending to it
 *  risks bounces that damage sender reputation), scoped to given plan tiers. */
export async function findMarketingOptedInTeachers(
  planTiers: string[]
): Promise<Array<{ id: string; email: string; name: string | null }>> {
  const { rows } = await pool.query<{ id: string; email: string; name: string | null }>(
    `SELECT id, email, name FROM teachers
     WHERE marketing_emails_enabled = TRUE AND is_active = TRUE
       AND email_verified_at IS NOT NULL AND plan_tier = ANY($1)
     ORDER BY email`,
    [planTiers]
  )
  return rows
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

// ─── SAML SSO — JIT provisioning ──────────────────────────────────────────────

/**
 * Account pre-hijack guard, shared by both JIT paths below. If an SSO/LTI
 * launch matches an EXISTING account whose email was never verified, that
 * account may have been pre-registered by someone else who merely typed this
 * teacher's address into the signup form — and who still knows its password.
 * The IdP has just attested the email, so we mark it verified, but first
 * rotate the password to a random value and stamp password_changed_at:
 * the authenticate middleware rejects any JWT issued before that stamp, so
 * every session the pre-registrant holds dies right here. A teacher who
 * legitimately self-registered and simply never clicked the verify link
 * loses nothing they can't recover — password reset goes to the email they
 * demonstrably own.
 */
async function neutralizeUnverifiedPreRegistration(row: TeacherRow): Promise<void> {
  if (row.email_verified_at != null) return
  const randomPassword = randomBytes(32).toString('hex')
  const passwordHash   = await bcrypt.hash(randomPassword, 12)
  await pool.query(
    `UPDATE teachers SET
       password_hash       = $2,
       password_changed_at = NOW(),
       email_verified_at   = NOW()
     WHERE id = $1`,
    [row.id, passwordHash]
  )
}

/**
 * Find a teacher by email or create one from a SAML assertion. Called from
 * the ACS handler after the IdP signature is verified.
 *
 * - Match is on lowercased email (the same key used elsewhere).
 * - For an existing teacher we attach the SAML subject + institution if not
 *   already set, but never overwrite a name the teacher edited themselves.
 * - For a new teacher we generate an unguessable random password hash that
 *   no one ever uses — password auth still works for non-SSO teachers, but
 *   this row is effectively SSO-only.
 *
 * Returns the full TeacherRow so the caller can mint a JWT immediately.
 */
export async function findOrCreateSamlTeacher(params: {
  email:         string
  name:          string | null
  institutionId: string
  samlSubject:   string
}): Promise<TeacherRow> {
  const email = params.email.toLowerCase()

  const existing = await findTeacherByEmail(email)
  if (existing) {
    await neutralizeUnverifiedPreRegistration(existing)
    // Backfill SSO fields the first time this teacher logs in via SAML —
    // but never re-attach to a different institution if they already have one.
    await pool.query(
      `UPDATE teachers SET
         saml_subject        = COALESCE(saml_subject, $2),
         saml_provisioned_at = COALESCE(saml_provisioned_at, NOW()),
         institution_id      = COALESCE(institution_id, $3)
       WHERE id = $1`,
      [existing.id, params.samlSubject, params.institutionId]
    )
    const row = (await findTeacherRowById(existing.id))!
    // If this login just attached them to the institution (or they were a
    // member without a primary unit), place them into the default kafedra so
    // they surface in leadership dashboards. Never overwrites a placement.
    if (row.institution_id) await assignDefaultDepartmentIfUnset(row.id, row.institution_id)
    return (await findTeacherRowById(existing.id))!
  }

  // Random 256-bit hex password — long enough that bcrypt with cost 12 won't
  // be brute-forced even if the hash leaks. The SAML teacher never sees it.
  const randomPassword = randomBytes(32).toString('hex')
  const passwordHash   = await bcrypt.hash(randomPassword, 12)

  const { rows } = await pool.query<TeacherRow>(
    `INSERT INTO teachers (email, password_hash, name, institution_id,
                            saml_subject, saml_provisioned_at, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [email, passwordHash, params.name, params.institutionId, params.samlSubject]
  )
  // New SAML teacher — place into the institution's default kafedra (§7:
  // every member should sit somewhere in the tree from day one).
  await assignDefaultDepartmentIfUnset(rows[0].id, params.institutionId)

  // findOrCreate must return the full institution-joined row so the JWT can
  // be minted with the right effective tier — re-fetch through the joined query.
  return (await findTeacherRowById(rows[0].id))!
}

// ─── LTI 1.3 — JIT provisioning ────────────────────────────────────────────────

/**
 * Find a teacher by email or create one from an LTI launch's id_token. Direct
 * mirror of findOrCreateSamlTeacher — same "never re-attach institution_id
 * across institutions" guard, same always-place-in-default-department call.
 * Called from the /api/lti/launch handler after the platform's signature is
 * verified via services/lti.ts validateLaunchToken().
 */
export async function findOrCreateLtiTeacher(params: {
  email:         string
  name:          string | null
  institutionId: string
  ltiSubject:    string
}): Promise<TeacherRow> {
  const email = params.email.toLowerCase()

  const existing = await findTeacherByEmail(email)
  if (existing) {
    await neutralizeUnverifiedPreRegistration(existing)
    await pool.query(
      `UPDATE teachers SET
         lti_subject        = COALESCE(lti_subject, $2),
         lti_provisioned_at = COALESCE(lti_provisioned_at, NOW()),
         institution_id     = COALESCE(institution_id, $3)
       WHERE id = $1`,
      [existing.id, params.ltiSubject, params.institutionId]
    )
    const row = (await findTeacherRowById(existing.id))!
    if (row.institution_id) await assignDefaultDepartmentIfUnset(row.id, row.institution_id)
    return (await findTeacherRowById(existing.id))!
  }

  // Random 256-bit hex password — the LTI-launched teacher never sees or
  // needs it; the platform (Moodle) owns their credentials.
  const randomPassword = randomBytes(32).toString('hex')
  const passwordHash   = await bcrypt.hash(randomPassword, 12)

  const { rows } = await pool.query<TeacherRow>(
    `INSERT INTO teachers (email, password_hash, name, institution_id,
                            lti_subject, lti_provisioned_at, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
     RETURNING *`,
    [email, passwordHash, params.name, params.institutionId, params.ltiSubject]
  )
  await assignDefaultDepartmentIfUnset(rows[0].id, params.institutionId)

  return (await findTeacherRowById(rows[0].id))!
}
