/**
 * An image URL an https page can actually load.
 *
 * Yandex Images hands back thumbnail and image links over plain http —
 * `http://avatars.mds.yandex.net/i?id=…-images-thumbs` — and we stored them
 * verbatim, so every deck carrying a searched image filled the browser
 * console with «Mixed Content: The page at 'https://ispum.ru/presentations'
 * was loaded over HTTPS, but requested an insecure element» (reported from
 * production 2026-09-10). Chrome auto-upgrades those requests and then blocks
 * the image if the upgrade fails, so we are not choosing between http and
 * https here — the browser already made that choice. All we control is
 * whether the page looks broken to anyone reading its console, and whether a
 * stricter client (or a stricter CSP later) shows the picture at all.
 *
 * Applied at BOTH ends deliberately: at ingest for everything stored from now
 * on, and at render for the images already sitting in `presentations.slides`
 * as JSONB, which no migration is going to rewrite.
 *
 * Only image URLs. A `source_url` is a link a teacher clicks to check the
 * origin of a picture, and upgrading that would break the http-only sites
 * that a Russian university's own materials are still routinely hosted on —
 * a navigation raises no mixed-content warning, so there is nothing to fix.
 */
export function toHttpsUrl(url: string): string
export function toHttpsUrl(url: string | null | undefined): string | null | undefined
export function toHttpsUrl(url: string | null | undefined): string | null | undefined {
  if (!url) return url
  // Protocol-relative (`//host/path`) resolves to the page's own scheme, which
  // is https in production and http on a dev server — pin it.
  if (url.startsWith('//')) return `https:${url}`
  return url.startsWith('http://') ? `https://${url.slice('http://'.length)}` : url
}
