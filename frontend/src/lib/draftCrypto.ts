// AES-GCM encryption for grading drafts persisted to localStorage
// (TODO.md #4 — student `submission_text` sat there in plaintext between
// sessions; a stolen unlocked laptop is a real 152-ФЗ posture concern).
//
// Key is derived from the current JWT via SHA-256, so it rotates whenever
// the teacher logs in again with a new token, and old encrypted drafts
// become unreadable (harmless — clearGradingDrafts() already wipes them on
// logout; this is defense-in-depth for the window before that runs, e.g. a
// token that expired without an explicit logout).
//
// Kept as a plain SHA-256-of-token key (not a proper KDF like HKDF) — the
// JWT itself is already a high-entropy secret an attacker reading
// localStorage would also have direct access to, so this only defends
// against someone reading the disk file *without* also having the live
// browser session (e.g. a cold copy of the profile directory).

import { getAuthToken } from './authToken'

let cachedKeyPromise: Promise<CryptoKey> | null = null
let cachedForToken: string | null = null

function getKey(): Promise<CryptoKey> | null {
  const token = getAuthToken()
  if (!token) return null
  if (cachedForToken === token && cachedKeyPromise) return cachedKeyPromise
  cachedForToken = token
  cachedKeyPromise = deriveKey(token)
  return cachedKeyPromise
}

async function deriveKey(token: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return crypto.subtle.importKey('raw', hash, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

/** Returns null if there's no active session (nothing to key the encryption off). */
export async function encryptForStorage(value: unknown): Promise<string | null> {
  const keyPromise = getKey()
  if (!keyPromise) return null
  const key = await keyPromise
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const data = new TextEncoder().encode(JSON.stringify(value))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data)
  return `${bufToB64(iv)}:${bufToB64(ciphertext)}`
}

/** Returns null on any failure — wrong-session key, corrupted payload, no session. */
export async function decryptFromStorage<T>(payload: string): Promise<T | null> {
  const keyPromise = getKey()
  if (!keyPromise) return null
  try {
    const key = await keyPromise
    const [ivB64, ctB64] = payload.split(':')
    if (!ivB64 || !ctB64) return null
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: b64ToBuf(ivB64) },
      key,
      b64ToBuf(ctB64)
    )
    return JSON.parse(new TextDecoder().decode(plaintext)) as T
  } catch {
    return null
  }
}

function bufToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

function b64ToBuf(b64: string): ArrayBuffer {
  const binary = atob(b64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes.buffer
}
