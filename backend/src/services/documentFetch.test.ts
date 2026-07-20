import { describe, it, expect, afterEach } from 'vitest'
import { isHostAllowed, resolveAllowedDomains, deriveFilename, fetchDocumentFromUrl, normalizeDomain, isBlockedIp } from './documentFetch'
import { detectMimeFromBuffer } from '../middleware/fileValidation'

// ── Host allowlist — the security boundary ────────────────────────────────────
describe('isHostAllowed', () => {
  const allowed = ['kstu.ru', 'example.edu']

  it('accepts an exact host match', () => {
    expect(isHostAllowed('kstu.ru', allowed)).toBe(true)
  })
  it('accepts a subdomain of an allowed domain', () => {
    expect(isHostAllowed('www.kstu.ru', allowed)).toBe(true)
    expect(isHostAllowed('docs.portal.kstu.ru', allowed)).toBe(true)
  })
  it('is case-insensitive and tolerates a trailing dot (FQDN form)', () => {
    expect(isHostAllowed('WWW.KSTU.RU', allowed)).toBe(true)
    expect(isHostAllowed('www.kstu.ru.', allowed)).toBe(true)
  })
  it('rejects a host not on the list', () => {
    expect(isHostAllowed('evil.com', allowed)).toBe(false)
  })
  it('rejects a look-alike suffix that is not a real subdomain', () => {
    // notkstu.ru must NOT match kstu.ru — endsWith without the dot boundary
    // would be the classic bug this guards against.
    expect(isHostAllowed('notkstu.ru', allowed)).toBe(false)
    expect(isHostAllowed('kstu.ru.evil.com', allowed)).toBe(false)
  })
  it('rejects everything when the allowlist is empty', () => {
    expect(isHostAllowed('kstu.ru', [])).toBe(false)
  })
})

// ── Allowlist resolution — institution domain + env supplement ─────────────────
describe('resolveAllowedDomains', () => {
  const OLD = process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS
  afterEach(() => {
    if (OLD === undefined) delete process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS
    else process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS = OLD
  })

  it("includes the institution's own configured domains, lowercased", () => {
    delete process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS
    expect(resolveAllowedDomains({ document_fetch_domains: ['KSTU.ru'] })).toEqual(['kstu.ru'])
  })
  it('merges the env supplement and de-dupes', () => {
    process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS = 'mephi.ru, kstu.ru'
    expect(resolveAllowedDomains({ document_fetch_domains: ['kstu.ru'] }).sort()).toEqual(['kstu.ru', 'mephi.ru'])
  })
  it('is empty for an institution with no domains and no env', () => {
    delete process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS
    expect(resolveAllowedDomains({ document_fetch_domains: [] })).toEqual([])
    expect(resolveAllowedDomains(null)).toEqual([])
  })
  it('is NOT tied to email_domain anymore (decoupled from auto-join)', () => {
    delete process.env.DOCUMENT_FETCH_ALLOWED_DOMAINS
    // An institution with an email_domain but no configured fetch domains gets
    // an empty allowlist — the two settings are independent now.
    expect(resolveAllowedDomains({ document_fetch_domains: [] })).toEqual([])
  })
})

// ── Private-IP guard (anti-SSRF, holds even against a malicious allowlist) ────
describe('isBlockedIp', () => {
  it('blocks IPv4 private / loopback / link-local / CGNAT / reserved ranges', () => {
    for (const ip of [
      '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
      '127.0.0.1', '169.254.169.254',  // ← cloud metadata endpoint
      '100.64.0.1', '0.0.0.0', '198.18.0.1', '224.0.0.1', '255.255.255.255',
    ]) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })
  it('allows genuine public IPv4', () => {
    for (const ip of ['8.8.8.8', '93.184.216.34', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255']) {
      expect(isBlockedIp(ip), ip).toBe(false)
    }
  })
  it('blocks IPv6 loopback / unspecified / ULA / link-local / multicast', () => {
    for (const ip of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1']) {
      expect(isBlockedIp(ip), ip).toBe(true)
    }
  })
  it('blocks IPv4-mapped and NAT64 IPv6 that smuggle an internal v4 target', () => {
    expect(isBlockedIp('::ffff:127.0.0.1')).toBe(true)
    expect(isBlockedIp('::ffff:169.254.169.254')).toBe(true)
    expect(isBlockedIp('::ffff:a9fe:a9fe')).toBe(true)   // hex form of 169.254.169.254
    expect(isBlockedIp('64:ff9b::169.254.169.254')).toBe(true)
  })
  it('allows genuine public IPv6', () => {
    expect(isBlockedIp('2606:2800:220:1:248:1893:25c8:1946')).toBe(false)
    expect(isBlockedIp('2001:4860:4860::8888')).toBe(false)
  })
  it('fails closed on anything that is not a valid IP', () => {
    expect(isBlockedIp('not-an-ip')).toBe(true)
    expect(isBlockedIp('')).toBe(true)
    expect(isBlockedIp('999.999.999.999')).toBe(true)
  })
})

// ── Domain normalisation (route input sanitising) ─────────────────────────────
describe('normalizeDomain', () => {
  it('accepts a bare hostname', () => {
    expect(normalizeDomain('kstu.ru')).toBe('kstu.ru')
  })
  it('rejects a raw IP literal (allowlist holds hostnames, not IPs)', () => {
    expect(normalizeDomain('10.0.0.5')).toBeNull()
    expect(normalizeDomain('169.254.169.254')).toBeNull()
    expect(normalizeDomain('8.8.8.8')).toBeNull()
  })
  it('lowercases and trims', () => {
    expect(normalizeDomain('  KSTU.RU  ')).toBe('kstu.ru')
  })
  it('strips a pasted scheme, path, query and port', () => {
    expect(normalizeDomain('https://www.kstu.ru:443/getpilot?id=1')).toBe('kstu.ru')
  })
  it('strips a leading www.', () => {
    expect(normalizeDomain('www.kstu.ru')).toBe('kstu.ru')
  })
  it('rejects entries without a dot or with illegal characters', () => {
    expect(normalizeDomain('localhost')).toBeNull()
    expect(normalizeDomain('not a domain')).toBeNull()
    expect(normalizeDomain('')).toBeNull()
  })
})

// ── Filename derivation ────────────────────────────────────────────────────────
describe('deriveFilename', () => {
  const url = new URL('https://www.kstu.ru/getpilot?id=478501')

  it('prefers RFC 5987 filename*=UTF-8 (decoded, non-ASCII safe)', () => {
    const cd = "attachment; filename*=UTF-8''%D0%A0%D0%9F%D0%94.pdf"
    expect(deriveFilename(cd, url, 'application/pdf')).toBe('РПД.pdf')
  })
  it('falls back to a plain filename= token', () => {
    expect(deriveFilename('attachment; filename="plan.pdf"', url, 'application/pdf')).toBe('plan.pdf')
  })
  it('uses the URL path segment when it has a real extension', () => {
    const u = new URL('https://www.kstu.ru/files/rpd-2026.pdf')
    expect(deriveFilename(undefined, u, 'application/pdf')).toBe('rpd-2026.pdf')
  })
  it('synthesizes a name from the detected type when nothing else is available', () => {
    // getpilot?id=… has no usable extension → synthesized.
    expect(deriveFilename(undefined, url, 'application/pdf')).toBe('документ.pdf')
    expect(deriveFilename(undefined, url, 'image/png')).toBe('документ.png')
  })
})

// ── Magic-byte detection (reused for the fetched buffer) ───────────────────────
describe('detectMimeFromBuffer', () => {
  it('detects a PDF signature', () => {
    expect(detectMimeFromBuffer(Buffer.from('255044462d', 'hex'))).toBe('application/pdf')  // %PDF-
  })
  it('detects a PNG signature', () => {
    expect(detectMimeFromBuffer(Buffer.from('89504e470d0a', 'hex'))).toBe('image/png')
  })
  it('returns null for an unrecognised signature (e.g. an HTML page)', () => {
    expect(detectMimeFromBuffer(Buffer.from('<!DOCTYPE html>'))).toBeNull()
  })
})

// ── URL validation (via the public entry point, before any network) ────────────
describe('fetchDocumentFromUrl — pre-flight validation', () => {
  const allowed = ['kstu.ru']

  it('rejects a non-https scheme', async () => {
    await expect(fetchDocumentFromUrl('http://www.kstu.ru/x.pdf', allowed))
      .rejects.toThrow(/https/i)
  })
  it('rejects an unparseable URL', async () => {
    await expect(fetchDocumentFromUrl('not a url', allowed)).rejects.toThrow(/некорректн/i)
  })
  it('rejects a host outside the allowlist before making any request', async () => {
    await expect(fetchDocumentFromUrl('https://evil.com/x.pdf', allowed))
      .rejects.toThrow(/сайта вашего вуза/i)
  })
  it('rejects when the allowlist is empty (feature not configured)', async () => {
    await expect(fetchDocumentFromUrl('https://www.kstu.ru/x.pdf', []))
      .rejects.toThrow(/не настроил|недоступна/i)
  })
})
