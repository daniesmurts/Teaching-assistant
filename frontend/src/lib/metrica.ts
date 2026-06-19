// Yandex Metrica integration.
//
// Privacy stance (152-ФЗ): the counter has Webvisor (session replay) enabled,
// which records the on-screen DOM. The authenticated app displays student
// personal data — names, submission text, grades — so Metrica must NEVER run on
// those pages. We therefore:
//   1. do NOT init the counter in index.html (only the loader is there);
//   2. init from JS only for logged-OUT visitors on public/marketing pages;
//   3. hard-reload at the login boundary (see hooks/useAuth.ts) so any replay
//      session started on /login is torn down before the app loads.
// Net effect: Metrica/Webvisor only ever sees anonymous marketing-funnel pages.

export const METRICA_ID = 109625339

declare global {
  interface Window {
    ym?: (id: number, action: string, ...args: unknown[]) => void
  }
}

// Authenticated app areas — Metrica must never initialise while on these paths.
const PRIVATE_PREFIXES = [
  '/dashboard', '/courses', '/grading', '/criteria', '/students',
  '/presentations', '/billing', '/settings', '/help', '/admin',
  // SSO callback URL carries a live JWT in the query string — never let
  // Webvisor/session-replay capture it.
  '/sso',
]

export function isPublicPath(pathname: string): boolean {
  return !PRIVATE_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))
}

let initialised = false

/** Initialise the counter (with Webvisor). Safe to call repeatedly. */
export function initMetrica(): void {
  if (initialised || typeof window.ym !== 'function') return
  initialised = true
  window.ym(METRICA_ID, 'init', {
    ssr:                 true,
    webvisor:            true,
    clickmap:            true,
    ecommerce:           'dataLayer',
    accurateTrackBounce: true,
    trackLinks:          true,
  })
}

/** Report a virtual page view on SPA navigation. No-op until initialised. */
export function metricaHit(url: string): void {
  if (!initialised) return
  window.ym?.(METRICA_ID, 'hit', url)
}
