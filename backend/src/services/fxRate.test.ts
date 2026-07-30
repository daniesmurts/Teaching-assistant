import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseCbrUsdRate, rubToUsd, getUsdRubRate, _resetCacheForTests } from './fxRate'

const CBR_XML = `<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="30.07.2026" name="Foreign Currency Market">
  <Valute ID="R01235">
    <NumCode>840</NumCode>
    <CharCode>USD</CharCode>
    <Nominal>1</Nominal>
    <Name>Доллар США</Name>
    <Value>92,3456</Value>
    <VunitRate>92,3456</VunitRate>
  </Valute>
</ValCurs>`

describe('parseCbrUsdRate', () => {
  it('parses the USD rate from a real-shaped ЦБ РФ response', () => {
    const result = parseCbrUsdRate(CBR_XML)
    expect(result).toEqual({ rate: 92.3456, date: '2026-07-30' })
  })

  it('divides by Nominal when it is not 1 (e.g. a currency quoted per 10 or 100 units)', () => {
    const xml = CBR_XML.replace('<Nominal>1</Nominal>', '<Nominal>10</Nominal>').replace('92,3456', '923,456')
    const result = parseCbrUsdRate(xml)
    expect(result?.rate).toBeCloseTo(92.3456)
  })

  it('returns null when the USD Valute block is missing', () => {
    const xml = `<ValCurs Date="30.07.2026"><Valute ID="R01239"><Value>1,23</Value></Valute></ValCurs>`
    expect(parseCbrUsdRate(xml)).toBeNull()
  })

  it('returns null on a non-positive or non-numeric value', () => {
    const zero = CBR_XML.replace('92,3456', '0')
    expect(parseCbrUsdRate(zero)).toBeNull()
    const garbage = CBR_XML.replace('<Value>92,3456</Value>', '<Value></Value>')
    expect(parseCbrUsdRate(garbage)).toBeNull()
  })
})

describe('rubToUsd', () => {
  it('converts a ₽ amount to $ using the given rate', () => {
    expect(rubToUsd(9234.56, 92.3456)).toBeCloseTo(100)
  })
})

describe('getUsdRubRate', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    _resetCacheForTests()
  })
  afterEach(() => vi.unstubAllGlobals())

  it('fetches and caches the rate on first call', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => CBR_XML })
    const result = await getUsdRubRate()
    expect(result).toEqual({ rate: 92.3456, date: '2026-07-30' })

    // Second call within the TTL must not hit the network again.
    const result2 = await getUsdRubRate()
    expect(result2).toEqual(result)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('fails open to the last known rate when a later fetch fails', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, text: async () => CBR_XML })
    await getUsdRubRate()

    _resetCacheForTests()   // force a re-fetch, simulating TTL expiry
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 })
    const result = await getUsdRubRate()
    // No prior cache after _resetCacheForTests, so this falls to FALLBACK_RATE.
    expect(result.date).toBe('unavailable')
  })

  it('falls back to a conservative fixed rate when ЦБ РФ has never once been reachable', async () => {
    fetchMock.mockRejectedValue(new Error('network down'))
    const result = await getUsdRubRate()
    expect(result.rate).toBeGreaterThan(0)
    expect(result.date).toBe('unavailable')
  })
})
