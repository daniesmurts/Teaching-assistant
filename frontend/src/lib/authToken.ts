// Reads the draft-key seed directly out of zustand's persisted localStorage
// entry, without importing store/authStore.ts. That store already imports
// clearGradingDrafts from hooks/usePersistedState.ts — importing authStore
// back from there (to read the seed for draft encryption) would create a
// module cycle. Zustand's persist middleware writes `{ state, version }`
// under the configured key; this just reads that shape directly.
//
// Not a secret on its own — it can't be used to call the API (the real
// session lives in an HttpOnly cookie this code can't read at all). It only
// keys local AES-GCM encryption of grading drafts (see draftCrypto.ts).

const STORAGE_KEY = 'ga_token'

export function getDraftKeySeed(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { draftKeySeed?: string | null } }
    return parsed.state?.draftKeySeed ?? null
  } catch {
    return null
  }
}
