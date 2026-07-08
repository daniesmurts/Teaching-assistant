// Pure grace-period logic for NewVersionToast — split out so it's testable
// without mocking the `virtual:pwa-register/react` module.
export const SW_UPDATE_GRACE_MS = 24 * 60 * 60 * 1000   // 24h

/** True once `now` is more than the grace period past `firstSeenAt` — the
 *  point at which a dismissible "update available" prompt escalates to a
 *  mandatory one, so a waiting service worker can't be silently ignored
 *  forever by a pinned/long-lived tab. */
export function isUpdateStale(firstSeenAt: number, now: number): boolean {
  return now - firstSeenAt > SW_UPDATE_GRACE_MS
}
