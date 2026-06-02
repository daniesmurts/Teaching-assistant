import crypto from 'crypto'
import { pool } from '../connection'

// ─── Token hashing ────────────────────────────────────────────────────────────
// We store SHA-256(token) in the DB for O(1) lookup.
// Raw 32-byte random tokens have 256 bits of entropy so SHA-256 is secure for
// single-use, short-lived tokens — bcrypt is unnecessary here.

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

export function generateRawToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function invalidateExistingTokens(teacherId: string): Promise<void> {
  await pool.query(
    `UPDATE password_reset_tokens SET used = TRUE
     WHERE teacher_id = $1 AND used = FALSE`,
    [teacherId]
  )
}

export async function createResetToken(
  teacherId: string,
  tokenHash: string,
  expiresAt: Date
): Promise<void> {
  await pool.query(
    `INSERT INTO password_reset_tokens (teacher_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [teacherId, tokenHash, expiresAt]
  )
}

export interface ResetTokenRow {
  id:         string
  teacher_id: string
}

export async function findValidToken(
  tokenHash: string
): Promise<ResetTokenRow | null> {
  const { rows } = await pool.query<ResetTokenRow>(
    `SELECT id, teacher_id
     FROM password_reset_tokens
     WHERE token_hash = $1
       AND used = FALSE
       AND expires_at > NOW()
     LIMIT 1`,
    [tokenHash]
  )
  return rows[0] ?? null
}

export async function markTokenUsed(tokenId: string): Promise<void> {
  await pool.query(
    'UPDATE password_reset_tokens SET used = TRUE WHERE id = $1',
    [tokenId]
  )
}
