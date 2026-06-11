import { useEffect, useRef, useState } from 'react'

const PREFIX = 'ga:grading:'

/**
 * useState that mirrors its value into localStorage under a stable key.
 * Reads back on mount, writes on every change. Null/undefined values clear
 * the key. Use a `null` key to disable persistence (e.g. when the value
 * depends on data that isn't loaded yet).
 *
 * The PII tradeoff: this keeps in-progress student work on disk across
 * refreshes (and tab close). It's wiped on approve, on "Новая проверка",
 * and on logout — see clearGradingDrafts() below.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const fullKey = key ? PREFIX + key : null

  // Hydrate once from storage. We avoid passing a lazy initialiser to
  // useState so the *first* render of a freshly-mounted component picks up
  // whatever's currently in storage, even after key changes.
  const [value, setValue] = useState<T>(() => readKey(fullKey, initial))

  // Re-hydrate whenever the key changes (e.g. switching between assignments).
  const lastKey = useRef(fullKey)
  useEffect(() => {
    if (lastKey.current !== fullKey) {
      lastKey.current = fullKey
      setValue(readKey(fullKey, initial))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  // Mirror value into storage on change.
  useEffect(() => {
    if (!fullKey) return
    try {
      if (value === null || value === undefined) {
        localStorage.removeItem(fullKey)
      } else {
        localStorage.setItem(fullKey, JSON.stringify(value))
      }
    } catch {
      // Quota exceeded or private mode — best-effort, don't crash the page.
    }
  }, [fullKey, value])

  return [value, setValue]
}

function readKey<T>(fullKey: string | null, fallback: T): T {
  if (!fullKey) return fallback
  try {
    const raw = localStorage.getItem(fullKey)
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

/** Clear a specific draft. Used on approve / reset. */
export function clearPersistedState(key: string): void {
  try { localStorage.removeItem(PREFIX + key) } catch { /* noop */ }
}

/** Wipe every grading-draft key. Used on logout. */
export function clearGradingDrafts(): void {
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) localStorage.removeItem(k)
    }
  } catch { /* noop */ }
}
