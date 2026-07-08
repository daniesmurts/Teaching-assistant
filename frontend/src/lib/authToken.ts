// Reads the JWT directly out of zustand's persisted localStorage entry,
// without importing store/authStore.ts. That store already imports
// clearGradingDrafts from hooks/usePersistedState.ts — importing authStore
// back from there (to read the token for draft encryption) would create a
// module cycle. Zustand's persist middleware writes `{ state, version }`
// under the configured key; this just reads that shape directly.

const STORAGE_KEY = 'ga_token'

export function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: { token?: string | null } }
    return parsed.state?.token ?? null
  } catch {
    return null
  }
}
