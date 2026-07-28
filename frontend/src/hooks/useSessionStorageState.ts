import { useState, type Dispatch, type SetStateAction } from 'react'

const PREFIX = 'ispum:session:'

/**
 * useState that mirrors its value into sessionStorage under a stable key.
 * Reads back synchronously on mount, writes on every change. Tab-scoped and
 * cleared when the browser tab closes — good enough for "don't lose an
 * in-progress analysis on refresh" without the PII handling that
 * usePersistedState's localStorage+encryption gives student submissions.
 */
export function useSessionStorageState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const fullKey = PREFIX + key
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = sessionStorage.getItem(fullKey)
      return raw != null ? (JSON.parse(raw) as T) : initial
    } catch {
      return initial
    }
  })

  const setAndStore: Dispatch<SetStateAction<T>> = (update) => {
    setValue((prev) => {
      const next = typeof update === 'function' ? (update as (p: T) => T)(prev) : update
      try {
        if (next === null || next === undefined) sessionStorage.removeItem(fullKey)
        else sessionStorage.setItem(fullKey, JSON.stringify(next))
      } catch { /* quota exceeded or private mode — best-effort */ }
      return next
    })
  }

  return [value, setAndStore]
}
