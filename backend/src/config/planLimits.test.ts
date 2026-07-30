import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
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
