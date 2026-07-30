// ЦБ РФ (Bank of Russia) daily USD/RUB reference rate — the canonical
// accounting source for converting Yandex Cloud's ₽-denominated costs into
// the platform's usual $ reporting currency (api_usage_log.cost_usd stays
// the canonical figure; see TODO.md Improvement #13).
//
// Cached for a day (the rate itself is only published once/day) and
// fail-open to the last known rate — an FX lookup must never be the reason
// a grading or presentation call fails, same philosophy as spendCap.ts /
// globalSpendCap.ts. If we've never once fetched successfully (fresh
// deploy, ЦБ РФ unreachable), falls back to FALLBACK_RATE — deliberately a
// conservative (high) guess, so a broken FX fetch understates ₽ cost in $
// terms as little as possible rather than silently making it look cheap.

import { logger } from '../lib/logger'

const CBR_URL          = 'https://www.cbr.ru/scripts/XML_daily.asp'
const FETCH_TIMEOUT_MS = 8_000
const CACHE_TTL_MS     = 24 * 60 * 60 * 1000   // rate is published once/day

const FALLBACK_RATE = 100   // ₽ per $1 — used only if ЦБ РФ has never once been reachable

export interface UsdRubRate {
  rate: number   // ₽ per $1
  date: string    // ISO date (YYYY-MM-DD) the rate is officially FOR — 'unavailable' if we've never fetched
}

interface RateCacheEntry {
  rate:      number
  rateDate:  string
  fetchedAt: number
}

let cache: RateCacheEntry | null = null

/** Pure parser, split out so it's unit-testable without a network call. */
export function parseCbrUsdRate(xml: string): UsdRubRate | null {
  const valuteMatch = xml.match(/<Valute ID="R01235">([\s\S]*?)<\/Valute>/)
  if (!valuteMatch) return null

  const block        = valuteMatch[1]
  const nominalMatch = block.match(/<Nominal>(\d+)<\/Nominal>/)
  const valueMatch   = block.match(/<Value>([\d,.]+)<\/Value>/)
  if (!valueMatch) return null

  const nominal = nominalMatch ? Number(nominalMatch[1]) : 1
  const value   = Number(valueMatch[1].replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0 || !Number.isFinite(nominal) || nominal <= 0) return null

  const dateMatch = xml.match(/Date="(\d{2})\.(\d{2})\.(\d{4})"/)
  const date = dateMatch ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : new Date().toISOString().slice(0, 10)

  return { rate: value / nominal, date }
}

async function fetchCbrRate(): Promise<UsdRubRate | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const response = await fetch(CBR_URL, { signal: controller.signal })
    if (!response.ok) {
      logger.warn({ message: '[FxRate] ЦБ РФ request failed', status: response.status })
      return null
    }
    // ЦБ РФ serves the surrounding document as windows-1251, but every field
    // this parser reads (tags, digits, dots/commas) is ASCII — decoding as
    // utf-8 is fine here even though the Cyrillic currency names nearby
    // would come out mangled if we read them (we don't).
    const xml = await response.text()
    return parseCbrUsdRate(xml)
  } catch (err) {
    logger.warn({ message: '[FxRate] ЦБ РФ request errored', error: (err as Error).message })
    return null
  } finally {
    clearTimeout(timeout)
  }
}

/**
 * Returns today's (cached) USD→RUB rate, with the date it's officially for.
 * Fail-open: a fetch failure returns the last known rate, or FALLBACK_RATE
 * if we've never had one — never throws.
 */
export async function getUsdRubRate(): Promise<UsdRubRate> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_TTL_MS) {
    return { rate: cache.rate, date: cache.rateDate }
  }

  const fetched = await fetchCbrRate()
  if (fetched) {
    cache = { rate: fetched.rate, rateDate: fetched.date, fetchedAt: Date.now() }
    return fetched
  }

  if (cache) return { rate: cache.rate, date: cache.rateDate }   // stale but real
  return { rate: FALLBACK_RATE, date: 'unavailable' }
}

/** Pure — split out for tests. */
export function rubToUsd(amountRub: number, rate: number): number {
  return amountRub / rate
}

// Test-only — clears the module-level cache between test cases.
export function _resetCacheForTests(): void {
  cache = null
}
