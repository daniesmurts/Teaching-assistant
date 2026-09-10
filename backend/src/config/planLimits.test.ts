import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  calculateDeepSeekCost, isDeepSeekPeakHour,
  calculateYandexChatCostRub, calculateYandexEmbedCostRub,
  calculateYandexVisionCostRub, calculateYandexWebSearchCostRub, calculateYandexImageSearchCostRub,
  getYandexRatesRub,
} from './planLimits'

const RATE_ENV_VARS = [
  'YANDEX_RATE_CHAT_IN_RUB_PER_M', 'YANDEX_RATE_CHAT_OUT_RUB_PER_M',
  'YANDEX_RATE_EMBED_RUB_PER_M', 'YANDEX_RATE_VISION_RUB_PER_PAGE',
  'YANDEX_RATE_WEB_SEARCH_RUB_PER_CALL', 'YANDEX_RATE_IMAGE_SEARCH_RUB_PER_CALL',
]

describe('Yandex cost calculators', () => {
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => {
    for (const k of RATE_ENV_VARS) { saved[k] = process.env[k]; delete process.env[k] }
  })
  afterEach(() => {
    for (const k of RATE_ENV_VARS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })

  it('computes chat cost proportionally to input/output tokens at the default rates', () => {
    const rates = getYandexRatesRub()
    expect(calculateYandexChatCostRub(1_000_000, 0)).toBeCloseTo(rates.chatInPerM)
    expect(calculateYandexChatCostRub(0, 1_000_000)).toBeCloseTo(rates.chatOutPerM)
    expect(calculateYandexChatCostRub(500_000, 500_000)).toBeCloseTo((rates.chatInPerM + rates.chatOutPerM) / 2)
  })

  it('computes embed cost proportionally to tokens', () => {
    const rates = getYandexRatesRub()
    expect(calculateYandexEmbedCostRub(1_000_000)).toBeCloseTo(rates.embedPerM)
    expect(calculateYandexEmbedCostRub(0)).toBe(0)
  })

  it('computes vision cost per page', () => {
    const rates = getYandexRatesRub()
    expect(calculateYandexVisionCostRub(5)).toBeCloseTo(rates.visionPerPage * 5)
  })

  it('computes web-search and image-search cost separately, defaulting to 1 call', () => {
    const rates = getYandexRatesRub()
    expect(calculateYandexWebSearchCostRub()).toBeCloseTo(rates.webSearchPerCall)
    expect(calculateYandexWebSearchCostRub(3)).toBeCloseTo(rates.webSearchPerCall * 3)
    expect(calculateYandexImageSearchCostRub()).toBeCloseTo(rates.imageSearchPerCall)
    expect(calculateYandexImageSearchCostRub(3)).toBeCloseTo(rates.imageSearchPerCall * 3)
  })

  it('prices image search well above web search — they are different Cloud Search API products, not one', () => {
    const rates = getYandexRatesRub()
    expect(rates.imageSearchPerCall).toBeGreaterThan(rates.webSearchPerCall * 10)
  })

  it('honours a valid env override and falls back to the default for an invalid one', () => {
    process.env.YANDEX_RATE_CHAT_IN_RUB_PER_M = '350'
    process.env.YANDEX_RATE_EMBED_RUB_PER_M = 'not-a-number'
    const rates = getYandexRatesRub()
    expect(rates.chatInPerM).toBe(350)
    expect(rates.embedPerM).toBeGreaterThan(0)   // fell back to the built-in default, not NaN/0
  })

  it('rejects a zero or negative override the same way as an invalid one', () => {
    process.env.YANDEX_RATE_WEB_SEARCH_RUB_PER_CALL = '-5'
    const rates = getYandexRatesRub()
    expect(rates.webSearchPerCall).toBeGreaterThan(0)
  })
})

// ─── DeepSeek pricing (2026-09-10 rewrite) ───────────────────────────────────
//
// Two things under test that the old flat table got wrong: V4.1-Flash's real
// output rate, and the 2× peak/off-peak swing. A "1M in + 1M out" call makes
// the arithmetic readable — the peak total is just `in + out`.
describe('DeepSeek cost — peak vs off-peak', () => {
  const M = 1_000_000
  const at = (iso: string) => new Date(iso)

  it('charges the full V4.1-Flash rate during a weekday peak window', () => {
    // 0.30 in + 1.20 out per 1M, peak.
    expect(calculateDeepSeekCost(M, M, 'deepseek-flash', at('2026-09-15T02:00:00Z'))).toBeCloseTo(1.50, 6)
  })

  it('halves the rate off-peak', () => {
    expect(calculateDeepSeekCost(M, M, 'deepseek-flash', at('2026-09-15T12:00:00Z'))).toBeCloseTo(0.75, 6)
  })

  it('treats the whole weekend as off-peak, including peak-window hours', () => {
    expect(isDeepSeekPeakHour(at('2026-09-19T02:00:00Z'))).toBe(false)
    expect(calculateDeepSeekCost(M, M, 'deepseek-flash', at('2026-09-19T02:00:00Z'))).toBeCloseTo(0.75, 6)
  })

  it('gets both peak windows and their exclusive upper bounds right', () => {
    // 01:00–04:00 and 06:00–10:00 UTC — 04:00 and 10:00 are already off-peak,
    // and the 04:00–06:00 gap between the two windows is off-peak too.
    expect(isDeepSeekPeakHour(at('2026-09-15T01:00:00Z'))).toBe(true)
    expect(isDeepSeekPeakHour(at('2026-09-15T03:59:00Z'))).toBe(true)
    expect(isDeepSeekPeakHour(at('2026-09-15T04:00:00Z'))).toBe(false)
    expect(isDeepSeekPeakHour(at('2026-09-15T05:00:00Z'))).toBe(false)
    expect(isDeepSeekPeakHour(at('2026-09-15T06:00:00Z'))).toBe(true)
    expect(isDeepSeekPeakHour(at('2026-09-15T10:00:00Z'))).toBe(false)
    expect(isDeepSeekPeakHour(at('2026-09-15T00:30:00Z'))).toBe(false)
  })
})

describe('DeepSeek cost — model ids after the V4.1 consolidation', () => {
  const M = 1_000_000
  const PEAK = new Date('2026-09-15T02:00:00Z')

  it('prices every V4-era alias as the Flash model they now route to', () => {
    for (const id of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp']) {
      expect(calculateDeepSeekCost(M, M, id, PEAK)).toBeCloseTo(1.50, 6)
    }
  })

  it('still charges deepseek-v4-pro its own rate before the 2026-09-14 cutover', () => {
    // 12:00 Beijing on the 14th = 04:00 UTC. Friday the 11th, peak window.
    expect(calculateDeepSeekCost(M, M, 'deepseek-v4-pro', new Date('2026-09-11T02:00:00Z'))).toBeCloseTo(5.28, 6)
  })

  it('charges deepseek-v4-pro at Flash rates once it is routed to Flash', () => {
    expect(calculateDeepSeekCost(M, M, 'deepseek-v4-pro', PEAK)).toBeCloseTo(1.50, 6)
  })

  it('leaves retired V3-era ids flat, outside the peak/off-peak multiplier', () => {
    const peak    = calculateDeepSeekCost(M, M, 'deepseek-reasoner', PEAK)
    const offPeak = calculateDeepSeekCost(M, M, 'deepseek-reasoner', new Date('2026-09-15T12:00:00Z'))
    expect(peak).toBeCloseTo(2.74, 6)
    expect(offPeak).toBeCloseTo(2.74, 6)
  })

  it('falls back to Flash pricing for an unrecognised id (e.g. self-hosted on-prem weights)', () => {
    expect(calculateDeepSeekCost(M, M, 'some-onprem-model', PEAK)).toBeCloseTo(1.50, 6)
  })
})
