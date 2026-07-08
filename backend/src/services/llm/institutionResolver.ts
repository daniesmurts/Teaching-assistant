// Wires the registry's per-institution provider resolution to the actual
// database column added by migration 037. Kept out of the registry file
// itself so the LLM layer doesn't import db/queries directly (registry
// should remain pluggable / mockable).

import { pool } from '../../db/connection'
import { registerInstitutionResolver } from './registry'
import type { ProviderName } from './types'

// Narrower than ProviderName on purpose — gigachat is a registered provider
// (schema + registry stub) but not yet selectable via routes/institution.ts's
// own allow-list, since it isn't implemented (registry.ts throws on call).
// Keep in sync with that route's `allowed` array.
const VALID: ReadonlySet<ProviderName> = new Set(['deepseek', 'yandex'])

// Tiny in-process cache — the column never changes mid-request, and the
// registry calls resolve() per LLM round-trip. 60s TTL is fine.
interface Entry { provider: ProviderName | null; expires: number }
const cache = new Map<string, Entry>()

export async function getInstitutionPreferredProvider(institutionId: string): Promise<ProviderName | null> {
  const now = Date.now()
  const cached = cache.get(institutionId)
  if (cached && cached.expires > now) return cached.provider

  const { rows } = await pool.query<{ preferred_provider: string | null }>(
    `SELECT preferred_provider FROM institutions WHERE id = $1 LIMIT 1`,
    [institutionId]
  )
  const raw = rows[0]?.preferred_provider ?? null
  const provider = raw && VALID.has(raw as ProviderName) ? (raw as ProviderName) : null
  cache.set(institutionId, { provider, expires: now + 60_000 })
  return provider
}

// Drop a cached entry — call this from the admin endpoint that flips the
// column so the next request sees the new value immediately.
export function invalidateInstitutionProviderCache(institutionId: string): void {
  cache.delete(institutionId)
}

// Register on import. Idempotent — calling twice just overwrites.
registerInstitutionResolver(getInstitutionPreferredProvider)
