import axios, { AxiosError, type AxiosResponse } from 'axios'
import dns from 'node:dns'
import net from 'node:net'
import https, { type RequestOptions } from 'node:https'
import type { Duplex } from 'node:stream'
import { logger } from '../lib/logger'
import { ValidationError, DocumentProcessingError } from '../errors/AppError'
import {
  ALLOWED_MIME_TYPES, MAX_FILE_SIZE, repairUploadFilename, detectMimeFromBuffer,
} from '../middleware/fileValidation'
import type { InstitutionRow } from '../db/queries/institutions'

// Fetch a document straight from a university web system so a user can paste a
// link (e.g. https://www.kstu.ru/getpilot?id=478501) instead of downloading
// and re-uploading. Everything after "we have a buffer" is identical to an
// upload, so this returns a multer-file-shaped object the existing route
// handlers can drop into place unchanged.
//
// SECURITY — two independent layers:
//   1. Domain allowlist (per-institution, admin-managed) — governs which hosts
//      a *user* may point us at. Usability / misconfiguration guard.
//   2. Private-IP guard (below) — resolves the host and refuses any private /
//      reserved / loopback / link-local address, pinning the connection to the
//      validated IP so DNS rebinding can't swap it. This holds even when the
//      allowlist itself is attacker-controlled (a compromised admin adding a
//      hostname that resolves to an internal IP), so it's the real anti-SSRF
//      control — the allowlist alone is not.
// Plus: https only; every redirect hop re-validated (host + IP); hard size cap
// + timeout; GET only; the real type sniffed from magic bytes, not the header.
export interface FetchedFile {
  buffer:       Buffer
  originalname: string
  mimetype:     string
  size:         number
}

const FETCH_TIMEOUT_MS = 30_000
const MAX_REDIRECTS = 5
// A plain UA — some university portals 403 an empty/scripted agent.
const USER_AGENT = 'Mozilla/5.0 (compatible; ISPUM-DocumentFetch/1.0)'

const MIME_EXTENSION: Record<string, string> = {
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png':  'png',
}

// ── Private-IP guard (anti-SSRF) ──────────────────────────────────────────────
// The classifier below decides whether a resolved IP is off-limits. It's pure
// and exported for unit testing; it must fail CLOSED — anything it can't parse
// is treated as blocked.

function ipv4ToBytes(ip: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return null
  const b = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  return b.every((n) => n >= 0 && n <= 255) ? b : null
}

// Expand any legal IPv6 string (incl. `::` compression and an embedded IPv4
// tail like `::ffff:1.2.3.4`) to its 16 bytes; null if malformed.
function ipv6ToBytes(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0]   // drop any zone id
  if (s.includes('.')) {
    const lastColon = s.lastIndexOf(':')
    const v4 = ipv4ToBytes(s.slice(lastColon + 1))
    if (!v4) return null
    const hex = ((v4[0] << 8) | v4[1]).toString(16) + ':' + ((v4[2] << 8) | v4[3]).toString(16)
    s = s.slice(0, lastColon + 1) + hex
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const tail = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : null
  let groups: string[]
  if (tail === null) {
    groups = head
  } else {
    const fill = 8 - head.length - tail.length
    if (fill < 0) return null
    groups = [...head, ...new Array(fill).fill('0'), ...tail]
  }
  if (groups.length !== 8) return null
  const bytes: number[] = []
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null
    const v = parseInt(g, 16)
    bytes.push((v >> 8) & 0xff, v & 0xff)
  }
  return bytes
}

function isBlockedV4Bytes(b: number[]): boolean {
  const n = ((b[0] << 24) >>> 0) + (b[1] << 16) + (b[2] << 8) + b[3]
  const inRange = (a0: number, a1: number, a2: number, a3: number, bits: number): boolean => {
    const base = ((a0 << 24) >>> 0) + (a1 << 16) + (a2 << 8) + a3
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0
    return (n & mask) === (base & mask)
  }
  return (
    inRange(0, 0, 0, 0, 8)       // "this network"
    || inRange(10, 0, 0, 0, 8)      // private
    || inRange(100, 64, 0, 0, 10)   // CGNAT
    || inRange(127, 0, 0, 0, 8)     // loopback
    || inRange(169, 254, 0, 0, 16)  // link-local (cloud metadata lives here)
    || inRange(172, 16, 0, 0, 12)   // private
    || inRange(192, 0, 0, 0, 24)    // IETF protocol assignments
    || inRange(192, 168, 0, 0, 16)  // private
    || inRange(198, 18, 0, 0, 15)   // benchmarking
    || inRange(224, 0, 0, 0, 4)     // multicast
    || inRange(240, 0, 0, 0, 4)     // reserved (incl 255.255.255.255)
  )
}

function isBlockedV6Bytes(b: number[]): boolean {
  if (b.slice(0, 15).every((x) => x === 0) && (b[15] === 0 || b[15] === 1)) return true  // :: and ::1
  if (b[0] === 0xff) return true                            // ff00::/8 multicast
  if ((b[0] & 0xfe) === 0xfc) return true                   // fc00::/7 unique-local
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true  // fe80::/10 link-local
  return false
}

/**
 * True if `ip` (an IP literal from DNS resolution) is one we refuse to connect
 * to: private, loopback, link-local, CGNAT, reserved, multicast — for both v4
 * and v6, including IPv4-mapped (`::ffff:a.b.c.d`) and NAT64 (`64:ff9b::/96`)
 * forms that would otherwise smuggle a v4 target past a naive v6 check.
 * Anything unparseable is blocked (fail closed).
 */
export function isBlockedIp(ip: string): boolean {
  const fam = net.isIP(ip)
  if (fam === 4) {
    const b = ipv4ToBytes(ip)
    return b ? isBlockedV4Bytes(b) : true
  }
  if (fam === 6) {
    const b = ipv6ToBytes(ip)
    if (!b) return true
    const embeddedV4 =
      (b.slice(0, 10).every((x) => x === 0) && b[10] === 0xff && b[11] === 0xff)   // ::ffff:a.b.c.d
      || [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0].every((x, i) => b[i] === x)  // 64:ff9b::/96
    if (embeddedV4) return isBlockedV4Bytes(b.slice(12, 16))
    return isBlockedV6Bytes(b)
  }
  return true
}

// Marker carried on the lookup error so the fetch catch can report a clear
// "internal address" message instead of a generic connection failure.
const SSRF_MARK = 'SSRF_BLOCKED_IP'

// Custom DNS lookup: resolve ALL addresses, refuse if ANY is private (fail
// closed against split-horizon / round-robin records that mix public+internal),
// and hand the socket a validated IP. Because net connects to exactly this IP
// (while TLS still verifies the original hostname), there is no rebinding
// window between check and connect.
function secureLookup(hostname: string, options: unknown, callback: (...args: unknown[]) => void): void {
  dns.lookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) { callback(err); return }
    const list = Array.isArray(addresses) ? addresses : []
    if (list.length === 0) { callback(new Error(`${SSRF_MARK}:no-address`)); return }
    for (const a of list) {
      if (isBlockedIp(a.address)) { callback(new Error(`${SSRF_MARK}:${a.address}`)); return }
    }
    if (options && typeof options === 'object' && (options as { all?: boolean }).all) {
      callback(null, list)
    } else {
      callback(null, list[0].address, list[0].family)
    }
  })
}

// An https agent whose sockets resolve through secureLookup. All fetches are
// https (enforced per hop), so this covers every connection we make.
class SsrfSafeHttpsAgent extends https.Agent {
  createConnection(options: RequestOptions, callback?: (err: Error | null, stream: Duplex) => void): Duplex | null | undefined {
    const merged = { ...options, lookup: secureLookup } as RequestOptions
    const base = https.Agent.prototype.createConnection as
      (o: RequestOptions, cb?: (err: Error | null, s: Duplex) => void) => Duplex | null | undefined
    return base.call(this, merged, callback)
  }
}
const ssrfSafeHttpsAgent = new SsrfSafeHttpsAgent({ keepAlive: false })

/** Parse a comma/space-separated env list into lowercased, de-duped domains. */
function parseCsvEnv(raw: string | undefined): string[] {
  if (!raw) return []
  return [...new Set(
    raw.split(/[,\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean)
  )]
}

/**
 * Normalise a user-entered domain to a bare lowercase hostname: strips an
 * accidentally-pasted scheme/path/port and a leading "www.", trims, lowercases.
 * Returns null if what's left isn't a plausible domain (needs a dot and only
 * host-legal characters) — the caller drops nulls and reports invalid entries.
 * Exported for the route's validation and for unit tests.
 */
export function normalizeDomain(raw: string): string | null {
  let s = String(raw ?? '').trim().toLowerCase()
  if (!s) return null
  // Tolerate a full URL being pasted instead of a bare domain.
  s = s.replace(/^[a-z]+:\/\//, '').split('/')[0].split('?')[0].split('#')[0]
  s = s.split('@').pop() ?? s   // strip any user:pass@ or email local-part
  s = s.split(':')[0]           // strip :port
  s = s.replace(/^www\./, '').replace(/\.$/, '')
  // The allowlist holds hostnames, not raw IPs — reject IP literals so an admin
  // can't allowlist an internal address directly (the connect-time IP guard
  // would block it anyway, but keeping IPs out of the list is clearer).
  if (net.isIP(s) !== 0) return null
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(s)) return null
  if (!s.includes('.')) return null
  return s
}

/**
 * The domains this institution may fetch documents from: its own configured
 * allowlist (institutions.document_fetch_domains — managed by the institution
 * admin) plus a global env-configured supplement (DOCUMENT_FETCH_ALLOWED_DOMAINS).
 * Deliberately NOT tied to email_domain anymore — that field means auto-join
 * only; the fetch allowlist is its own explicit setting (migration 085).
 */
export function resolveAllowedDomains(institution: Pick<InstitutionRow, 'document_fetch_domains'> | null): string[] {
  const own = (institution?.document_fetch_domains ?? []).map((d) => d.trim().toLowerCase()).filter(Boolean)
  return [...new Set([...own, ...parseCsvEnv(process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS)])]
}

/** Host is allowed if it equals an allowed domain or is a subdomain of one. Case-insensitive. */
export function isHostAllowed(host: string, allowedDomains: string[]): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, '')   // strip trailing dot (FQDN form)
  if (!h) return false
  return allowedDomains.some((d) => {
    const dom = d.trim().toLowerCase()
    return dom.length > 0 && (h === dom || h.endsWith('.' + dom))
  })
}

/** Validate a URL string is an https URL whose host is on the allowlist; returns the parsed URL. */
function validateUrl(raw: string, allowedDomains: string[]): URL {
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    throw new ValidationError('Ссылка некорректна — проверьте адрес документа.')
  }
  if (parsed.protocol !== 'https:') {
    throw new ValidationError('Поддерживаются только ссылки, начинающиеся с https://.')
  }
  if (allowedDomains.length === 0) {
    throw new ValidationError(
      'Загрузка по ссылке недоступна — администратор ещё не настроил разрешённые домены. Скачайте файл и загрузите вручную.'
    )
  }
  if (!isHostAllowed(parsed.hostname, allowedDomains)) {
    throw new ValidationError(
      `Ссылки принимаются только с сайта вашего вуза (${allowedDomains.join(', ')}). Скачайте файл и загрузите его вручную.`
    )
  }
  return parsed
}

/** Derive a filename from Content-Disposition, else the URL path, else a synthesized name. */
export function deriveFilename(
  contentDisposition: string | undefined,
  url: URL,
  mimetype: string,
): string {
  // RFC 5987 filename*=UTF-8''… takes priority (properly encoded, non-ASCII safe).
  if (contentDisposition) {
    const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(contentDisposition)
    if (star?.[1]) {
      try { return repairUploadFilename(decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))) } catch { /* fall through */ }
    }
    const plain = /filename="?([^";]+)"?/i.exec(contentDisposition)
    if (plain?.[1]) return repairUploadFilename(plain[1].trim())
  }
  // Last path segment, if it looks like a real filename with an extension.
  const seg = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '')
  if (seg && /\.[a-z0-9]{2,5}$/i.test(seg)) return repairUploadFilename(seg)
  // Synthesize from the detected type.
  return `документ.${MIME_EXTENSION[mimetype] ?? 'pdf'}`
}

// HTML pages (the /sveden/education discovery flow) are capped separately
// from documents. Real университет disclosure pages (verified against
// kstu.ru's, one of our pilot universities) run to 13+ MB in a single
// response with no pagination — 24MB leaves real headroom above that,
// still bounded against genuine abuse.
const MAX_HTML_SIZE = 24 * 1024 * 1024
// The same real page took 2+ minutes to generate server-side (its own
// on-page banner warns "считывается большой объём информации за 6 лет,
// подождите") — this is normal for these sites, not a hang. A separate,
// longer timeout from the (fast) per-document fetch.
const PAGE_FETCH_TIMEOUT_MS = 240_000

/**
 * Best-effort charset from a Content-Type header's `charset=` parameter.
 * Exported for unit testing.
 */
export function charsetFromContentType(contentType: string | undefined): string | null {
  const m = /charset\s*=\s*"?([\w-]+)"?/i.exec(contentType ?? '')
  return m ? m[1].toLowerCase() : null
}

/**
 * Best-effort charset from a `<meta charset=…>` or `<meta http-equiv=
 * "Content-Type" content="…charset=…">` tag. The tag itself is always
 * ASCII-safe regardless of the body's real encoding, so a naive latin1
 * decode of just the head is enough to find it. Exported for unit testing.
 */
export function charsetFromMetaTag(buffer: Buffer): string | null {
  // The declaration is always near the top; scanning the whole multi-MB
  // buffer for it would be wasted work.
  const head = buffer.subarray(0, 4096).toString('latin1')
  const meta = /<meta[^>]+charset\s*=\s*"?([\w-]+)"?/i.exec(head)
  return meta ? meta[1].toLowerCase() : null
}

/**
 * Decode an HTML response body using its declared charset (header, else
 * meta tag, else UTF-8) instead of assuming UTF-8 — a real pilot
 * university's sveden page turned out to be windows-1251, which would
 * silently mangle every Cyrillic string in the parser if decoded blindly.
 * `TextDecoder` falls back to UTF-8 for any charset label it doesn't
 * recognise rather than throwing, so an unusual/legacy label degrades to
 * the previous behaviour instead of failing the whole fetch.
 */
export function decodeHtml(buffer: Buffer, contentTypeHeader: string | undefined): string {
  const charset = charsetFromContentType(contentTypeHeader) ?? charsetFromMetaTag(buffer) ?? 'utf-8'
  try {
    return new TextDecoder(charset).decode(buffer)
  } catch {
    return new TextDecoder('utf-8').decode(buffer)
  }
}

/**
 * Fetch an HTML page from an allowlisted URL (same SSRF/allowlist/redirect
 * discipline as fetchDocumentFromUrl) and return its markup. Used by the
 * sveden.education bulk-РПД discovery — the *page* is fetched here; each
 * individual document the user then confirms goes through fetchDocumentFromUrl.
 */
export async function fetchPageHtml(rawUrl: string, allowedDomains: string[]): Promise<{ html: string; finalUrl: string }> {
  let current = validateUrl(rawUrl, allowedDomains)

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let resp: AxiosResponse<ArrayBuffer>
    try {
      resp = await axios.get<ArrayBuffer>(current.toString(), {
        responseType:     'arraybuffer',
        timeout:          PAGE_FETCH_TIMEOUT_MS,
        maxContentLength: MAX_HTML_SIZE,
        maxBodyLength:    MAX_HTML_SIZE,
        maxRedirects:     0,
        headers:          { 'User-Agent': USER_AGENT },
        httpsAgent:       ssrfSafeHttpsAgent,
        validateStatus:   (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
      })
    } catch (err) {
      const ax = err as AxiosError
      const chain = `${ax.message ?? ''} ${((ax.cause as Error | undefined)?.message) ?? ''}`
      if (chain.includes(SSRF_MARK)) {
        throw new ValidationError('Ссылка ведёт на внутренний или зарезервированный адрес — загрузка запрещена в целях безопасности.')
      }
      if (ax.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' || ax.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED') {
        throw new DocumentProcessingError('Страница слишком большая для обработки.')
      }
      if (ax.code === 'ECONNABORTED') {
        throw new DocumentProcessingError('Страница слишком долго генерировалась на сайте вуза — попробуйте ещё раз позже.')
      }
      logger.warn({ message: 'Page fetch failed', url: current.hostname, error: ax.message, code: ax.code })
      throw new DocumentProcessingError('Не удалось открыть страницу по ссылке — проверьте, что она доступна.')
    }

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers['location'] as string | undefined
      if (!location) throw new DocumentProcessingError('Сервер вернул перенаправление без адреса.')
      if (hop === MAX_REDIRECTS) throw new DocumentProcessingError('Слишком много перенаправлений.')
      let next: URL
      try { next = new URL(location, current) } catch { throw new DocumentProcessingError('Страница перенаправляет на некорректный адрес.') }
      current = validateUrl(next.toString(), allowedDomains)
      continue
    }

    const contentTypeHeader = resp.headers['content-type'] as string | undefined
    const headerType = String(contentTypeHeader ?? '').split(';')[0].trim().toLowerCase()
    if (headerType && headerType !== 'text/html' && headerType !== 'application/xhtml+xml') {
      throw new DocumentProcessingError(
        'Ссылка ведёт на файл, а не на страницу. Вставьте адрес страницы «Сведения об образовательной организации → Образование».'
      )
    }
    const buffer = Buffer.from(resp.data as ArrayBuffer)
    return { html: decodeHtml(buffer, contentTypeHeader), finalUrl: current.toString() }
  }
  throw new DocumentProcessingError('Не удалось открыть страницу по ссылке.')
}

/**
 * Fetch a document from an allowlisted URL and return it in multer-file shape.
 * Throws ValidationError (400) for bad/blocked URLs and DocumentProcessingError
 * (422) for fetch/type failures — both carry Russian messages for the UI.
 */
export async function fetchDocumentFromUrl(rawUrl: string, allowedDomains: string[]): Promise<FetchedFile> {
  let current = validateUrl(rawUrl, allowedDomains)

  let response: AxiosResponse<ArrayBuffer> | null = null
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let resp: AxiosResponse<ArrayBuffer>
    try {
      resp = await axios.get<ArrayBuffer>(current.toString(), {
        responseType:    'arraybuffer',
        timeout:         FETCH_TIMEOUT_MS,
        maxContentLength: MAX_FILE_SIZE,
        maxBodyLength:    MAX_FILE_SIZE,
        maxRedirects:     0,   // handled manually so each hop is re-validated
        headers:          { 'User-Agent': USER_AGENT },
        // Resolve through the SSRF-safe agent: refuses private/internal IPs and
        // pins the connection to the validated address (no DNS rebinding).
        httpsAgent:       ssrfSafeHttpsAgent,
        // 3xx must resolve to the manual redirect branch, not throw.
        validateStatus:  (s) => (s >= 200 && s < 300) || (s >= 300 && s < 400),
      })
    } catch (err) {
      const ax = err as AxiosError
      // The private-IP guard rejects inside the socket lookup — surface a clear
      // reason rather than a generic "couldn't open".
      const chain = `${ax.message ?? ''} ${((ax.cause as Error | undefined)?.message) ?? ''}`
      if (chain.includes(SSRF_MARK)) {
        throw new ValidationError('Ссылка ведёт на внутренний или зарезервированный адрес — загрузка запрещена в целях безопасности.')
      }
      if (ax.code === 'ERR_FR_MAX_BODY_LENGTH_EXCEEDED' || ax.code === 'ERR_FR_MAX_CONTENT_LENGTH_EXCEEDED') {
        throw new DocumentProcessingError(`Документ по ссылке слишком большой. Максимум ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} МБ.`)
      }
      logger.warn({ message: 'Document URL fetch failed', url: current.hostname, error: ax.message, code: ax.code })
      throw new DocumentProcessingError('Не удалось загрузить документ по ссылке — проверьте, что она открывается напрямую.')
    }

    if (resp.status >= 300 && resp.status < 400) {
      const location = resp.headers['location'] as string | undefined
      if (!location) throw new DocumentProcessingError('Не удалось загрузить документ по ссылке — сервер вернул перенаправление без адреса.')
      if (hop === MAX_REDIRECTS) throw new DocumentProcessingError('Слишком много перенаправлений при загрузке документа.')
      // Resolve relative→absolute against the current URL, then re-validate the
      // new host against the allowlist — this is what stops a redirect bypass.
      let next: URL
      try { next = new URL(location, current) } catch { throw new DocumentProcessingError('Ссылка перенаправляет на некорректный адрес.') }
      current = validateUrl(next.toString(), allowedDomains)
      continue
    }
    response = resp
    break   // 2xx — done
  }

  if (!response) throw new DocumentProcessingError('Не удалось загрузить документ по ссылке.')

  const buffer = Buffer.from(response.data as ArrayBuffer)
  if (buffer.byteLength === 0) throw new DocumentProcessingError('По ссылке получен пустой файл.')
  if (buffer.byteLength > MAX_FILE_SIZE) {
    throw new DocumentProcessingError(`Документ по ссылке слишком большой. Максимум ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} МБ.`)
  }

  // Trust magic bytes over the server's Content-Type header; fall back to the
  // header only when the signature is unrecognised (e.g. a valid docx whose
  // first bytes we don't special-case beyond the zip signature).
  const sniffed = detectMimeFromBuffer(buffer)
  const headerType = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
  const mimetype = sniffed ?? headerType
  if (!ALLOWED_MIME_TYPES.has(mimetype)) {
    throw new DocumentProcessingError('Ссылка не ведёт на PDF, Word-документ или изображение.')
  }

  const originalname = deriveFilename(
    response.headers['content-disposition'] as string | undefined,
    current,
    mimetype,
  )

  return { buffer, originalname, mimetype, size: buffer.byteLength }
}
