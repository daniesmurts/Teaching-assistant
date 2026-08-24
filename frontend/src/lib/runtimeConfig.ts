// docs/on-prem-deployment.md §16 Track 2.2 — runtime deployment config,
// replacing the build-time-baked VITE_API_BASE_URL. Precedence:
//
//   1. window.__ISPUM_CONFIG__.apiBaseUrl, set by /config.js (public/config.js
//      in dev; a deployment-specific static file at the same path in prod)
//      — only if actually non-empty, so an unedited default config.js
//      (apiBaseUrl: "") falls through rather than winning.
//   2. VITE_API_BASE_URL — kept as the dev fallback, since local dev serves
//      no meaningful runtime config and the Vite dev server/backend run on
//      different ports (see .env.example).
//   3. '' — same-origin, our own cloud's actual production setup.
declare global {
  interface Window {
    __ISPUM_CONFIG__?: { apiBaseUrl?: string }
  }
}

export function getApiBaseUrl(): string {
  const runtime = window.__ISPUM_CONFIG__?.apiBaseUrl
  if (runtime) return runtime
  return import.meta.env.VITE_API_BASE_URL ?? ''
}
