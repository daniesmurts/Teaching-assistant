import { describe, it, expect } from 'vitest'
import { parseYandexImagesXml, rankImageCandidates } from './yandexImages'
import type { ImageCandidate } from '../../../shared/types'

function candidate(overrides: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: 'https://example.com/img.jpg',
    source_url: 'https://example.com/page',
    thumbnail: 'https://example.com/thumb.jpg',
    width: 800,
    height: 600,
    source_host: 'example.com',
    ...overrides,
  }
}

describe('rankImageCandidates', () => {
  it('drops candidates below the minimum dimension when both are known', () => {
    const small = candidate({ width: 300, height: 300, source_host: 'small.com' })
    const big   = candidate({ width: 800, height: 600, source_host: 'big.com' })
    const out = rankImageCandidates([small, big])
    expect(out.map((c) => c.source_host)).toEqual(['big.com'])
  })

  it('keeps candidates with unknown dimensions rather than penalising missing metadata', () => {
    const unknown = candidate({ width: null, height: null, source_host: 'unknown.com' })
    const out = rankImageCandidates([unknown])
    expect(out).toHaveLength(1)
  })

  it('drops when only one dimension is small', () => {
    const c = candidate({ width: 1200, height: 200 })
    expect(rankImageCandidates([c])).toHaveLength(0)
  })

  it('sinks known stock-photo hosts to the bottom instead of dropping them', () => {
    const stock    = candidate({ source_host: 'shutterstock.com' })
    const regular1 = candidate({ source_host: 'wikipedia.org' })
    const regular2 = candidate({ source_host: 'university.ru' })
    const out = rankImageCandidates([stock, regular1, regular2])
    expect(out.map((c) => c.source_host)).toEqual(['wikipedia.org', 'university.ru', 'shutterstock.com'])
  })

  it('matches stock host subdomains too', () => {
    const c = candidate({ source_host: 'www.istockphoto.com' })
    const regular = candidate({ source_host: 'wikipedia.org' })
    const out = rankImageCandidates([c, regular])
    expect(out.map((x) => x.source_host)).toEqual(['wikipedia.org', 'www.istockphoto.com'])
  })

  it('preserves relative order within the stock and non-stock groups (stable sort)', () => {
    const a = candidate({ source_host: 'a.com' })
    const b = candidate({ source_host: 'b.com' })
    const stock1 = candidate({ source_host: 'alamy.com' })
    const stock2 = candidate({ source_host: 'dreamstime.com' })
    const out = rankImageCandidates([stock1, a, stock2, b])
    expect(out.map((c) => c.source_host)).toEqual(['a.com', 'b.com', 'alamy.com', 'dreamstime.com'])
  })

  it('does not treat a host that merely contains a stock name as stock (no false positive)', () => {
    const lookalike = candidate({ source_host: 'notshutterstock.com.example.ru' })
    const realStock  = candidate({ source_host: 'shutterstock.com' })
    const out = rankImageCandidates([realStock, lookalike])
    // The real stock host sinks below the lookalike, proving the lookalike
    // wasn't matched as stock (otherwise stable sort would keep them in
    // their original order: realStock, lookalike).
    expect(out.map((c) => c.source_host)).toEqual(['notshutterstock.com.example.ru', 'shutterstock.com'])
  })
})

describe('parseYandexImagesXml — scheme', () => {
  // Yandex answers with plain-http links; stored verbatim they made every
  // deck with a searched image fill the browser console with mixed-content
  // warnings on https://ispum.ru (production, 2026-09-10).
  const xml = `<yandexsearch><response><results><grouping><group><doc>
    <url>http://example.org/article</url>
    <domain>example.org</domain>
    <image-link>http://avatars.mds.yandex.net/i?id=abc-images</image-link>
    <thumbnail-link>http://avatars.mds.yandex.net/i?id=abc-images-thumbs</thumbnail-link>
    <image-width>800</image-width><image-height>600</image-height>
  </doc></group></grouping></results></response></yandexsearch>`

  it('stores the image and its thumbnail over https', () => {
    const [c] = parseYandexImagesXml(xml)
    expect(c.url).toBe('https://avatars.mds.yandex.net/i?id=abc-images')
    expect(c.thumbnail).toBe('https://avatars.mds.yandex.net/i?id=abc-images-thumbs')
  })

  it('leaves source_url as the site published it', () => {
    // A link to click, not an element to load: no mixed-content warning is
    // raised by a navigation, and http-only hosts are still common for the
    // Russian university material these searches turn up.
    expect(parseYandexImagesXml(xml)[0].source_url).toBe('http://example.org/article')
  })
})
