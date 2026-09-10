import { describe, it, expect } from 'vitest'
import { toHttpsUrl } from '../../../shared/imageUrl'

describe('toHttpsUrl', () => {
  it('upgrades the Yandex thumbnail links that caused the mixed-content warnings', () => {
    // The literal shape from the production console, 2026-09-10.
    expect(toHttpsUrl('http://avatars.mds.yandex.net/i?id=dcb1632…-13104117-images-thumbs'))
      .toBe('https://avatars.mds.yandex.net/i?id=dcb1632…-13104117-images-thumbs')
  })

  it('leaves an https URL untouched', () => {
    expect(toHttpsUrl('https://example.org/x.png')).toBe('https://example.org/x.png')
  })

  it('leaves our own proxy routes alone — they are root-relative, not http', () => {
    expect(toHttpsUrl('/api/presentations/media/abc/image')).toBe('/api/presentations/media/abc/image')
  })

  it('pins a protocol-relative URL rather than letting a dev server make it http', () => {
    expect(toHttpsUrl('//cdn.example.org/x.png')).toBe('https://cdn.example.org/x.png')
  })

  it('does not touch a hostname that merely contains "http://" further along', () => {
    expect(toHttpsUrl('https://example.org/redirect?to=http://other.org/x.png'))
      .toBe('https://example.org/redirect?to=http://other.org/x.png')
  })

  it('passes empty and missing values through unchanged', () => {
    expect(toHttpsUrl('')).toBe('')
    expect(toHttpsUrl(null)).toBeNull()
    expect(toHttpsUrl(undefined)).toBeUndefined()
  })
})
