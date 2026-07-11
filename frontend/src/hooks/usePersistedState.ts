import { useEffect, useRef, useState } from 'react'
import { encryptForStorage, decryptFromStorage } from '../lib/draftCrypto'

const PREFIX = 'ga:grading:'

/**
 * useState that mirrors its value into localStorage (AES-GCM encrypted,
 * keyed off the current JWT — see lib/draftCrypto.ts) under a stable key.
 * Reads back on mount, writes on every change. Null/undefined values clear
 * the key. Use a `null` key to disable persistence (e.g. when the value
 * depends on data that isn't loaded yet).
 *
 * The PII tradeoff: this keeps in-progress student work on disk across
 * refreshes (and tab close), encrypted at rest. It's wiped on approve, on
 * "Новая проверка", and on logout — see clearGradingDrafts() below.
 *
 * Web Crypto has no synchronous API, so hydration is async: the first render
 * after a key change shows `initial`, then swaps in the decrypted draft a
 * moment later. A leftover plaintext entry from before encryption was added
 * (or a ciphertext from a since-expired session) simply fails to decrypt and
 * gets purged rather than crashing — self-healing, no migration code needed.
 */
export function usePersistedState<T>(
  key: string | null,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>] {
  const fullKey = key ? PREFIX + key : null
  const [value, setValue] = useState<T>(initial)
  const writeSeq = useRef(0)
  // Guards the mirror effect below from firing on the pre-hydration render.
  // Without this, a `null`-initial value (e.g. Grading.tsx's `page:result`)
  // reads as "nothing to persist" on mount and the mirror effect deletes the
  // key it hasn't even finished reading yet — under StrictMode's mount →
  // cleanup → remount, the first mount's decrypt lands after `cancelled` is
  // already true, so the correctly-decrypted value is discarded and the
  // just-deleted key never comes back. `[]`/`''`-initial values (the
  // `edits:*` drafts) never hit this because they're never `null`.
  const hydrated = useRef(false)

  // Hydrate on mount and whenever the key changes (e.g. switching assignments).
  useEffect(() => {
    let cancelled = false
    hydrated.current = false
    if (!fullKey) {
      setValue(initial)
      hydrated.current = true
      return
    }
    readKey(fullKey, initial).then((v) => {
      if (cancelled) return
      setValue(v)
      hydrated.current = true
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  // Mirror value into storage on change. writeSeq guards against a slow
  // encrypt from an earlier value landing after a newer one already wrote.
  useEffect(() => {
    if (!fullKey) return
    if (!hydrated.current) return
    const seq = ++writeSeq.current
    if (value === null || value === undefined) {
      try { localStorage.removeItem(fullKey) } catch { /* noop */ }
      return
    }
    encryptForStorage(value).then((encrypted) => {
      if (writeSeq.current !== seq || !encrypted) return
      try { localStorage.setItem(fullKey, encrypted) } catch {
        // Quota exceeded or private mode — best-effort, don't crash the page.
      }
    })
  }, [fullKey, value])

  return [value, setValue]
}

async function readKey<T>(fullKey: string | null, fallback: T): Promise<T> {
  if (!fullKey) return fallback
  let raw: string | null
  try {
    raw = localStorage.getItem(fullKey)
  } catch {
    return fallback
  }
  if (raw == null) return fallback

  const decrypted = await decryptFromStorage<T>(raw)
  if (decrypted === null) {
    // Undecryptable — corrupted, wrong-session key, or a pre-encryption
    // plaintext leftover. Can't trust it either way; purge and move on.
    try { localStorage.removeItem(fullKey) } catch { /* noop */ }
    return fallback
  }
  return decrypted
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
