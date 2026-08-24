import { logger } from '../lib/logger'
import type { SampleVacancy, ProfessionSnapshot, RegionSnapshot } from '../../../shared/types'
export type { RegionSnapshot } from '../../../shared/types'

// РОП Студия v0 (TODO.md Feature Z, Phase 0) — vacancy data for the
// «обоснование актуальности» generator. trudvsem.ru ("Работа в России") is
// a single fixed, platform-controlled open-data source — plain HTTP GET, no
// auth, no registration (confirmed live 2026-07-22) — so this calls it
// directly, unlike services/documentFetch.ts's SSRF-allowlist machinery,
// which exists for arbitrary user-supplied URLs, not a hardcoded endpoint.
// hh.ru was evaluated too but now requires a registered OAuth app for
// vacancy search (anonymous requests return 403) — deferred, not needed for
// v0 since trudvsem alone covers the pilot.

const TRUDVSEM_BASE = 'https://opendata.trudvsem.ru/api/v1'
const SAMPLES_PER_TERM = 5
const FETCH_TIMEOUT_MS = 15_000

// Every code below was individually confirmed live against trudvsem
// (2026-07-22) — there's no documented public reference endpoint for the
// full code list (an earlier attempt at /api/v1/regions 404s), so each one
// was queried and its returned vacancy's region.name checked against the
// expected name before being trusted. Two real surprises this caught:
// Chechnya sits at the "reserved but unused" code 20 (not 95, which turned
// out to belong to Херсонская область), and the four post-2022 territories
// (Запорожская область, ДНР, ЛНР, Херсонская область) use fgosvo-unrelated
// codes 90/93/94/95, not the sequential 80-84 the vehicle-plate convention
// would suggest. Names are trudvsem's own returned display names, lightly
// trimmed of redundant "Город "/parenthetical prefixes for the picker UI —
// the code, not the name, is what's sent to the API.
export const SUPPORTED_REGIONS: { code: string; name: string }[] = [
  { code: '2200000000000', name: 'Алтайский край' },
  { code: '2800000000000', name: 'Амурская область' },
  { code: '2900000000000', name: 'Архангельская область' },
  { code: '3000000000000', name: 'Астраханская область' },
  { code: '3100000000000', name: 'Белгородская область' },
  { code: '3200000000000', name: 'Брянская область' },
  { code: '3300000000000', name: 'Владимирская область' },
  { code: '3400000000000', name: 'Волгоградская область' },
  { code: '3500000000000', name: 'Вологодская область' },
  { code: '3600000000000', name: 'Воронежская область' },
  { code: '9300000000000', name: 'Донецкая Народная Республика' },
  { code: '7900000000000', name: 'Еврейская АО' },
  { code: '3700000000000', name: 'Ивановская область' },
  { code: '3800000000000', name: 'Иркутская область' },
  { code: '0700000000000', name: 'Кабардино-Балкарская Республика' },
  { code: '3900000000000', name: 'Калининградская область' },
  { code: '4000000000000', name: 'Калужская область' },
  { code: '4100000000000', name: 'Камчатский край' },
  { code: '0900000000000', name: 'Карачаево-Черкесская Республика' },
  { code: '4200000000000', name: 'Кемеровская область' },
  { code: '4300000000000', name: 'Кировская область' },
  { code: '4400000000000', name: 'Костромская область' },
  { code: '2300000000000', name: 'Краснодарский край' },
  { code: '2400000000000', name: 'Красноярский край' },
  { code: '4500000000000', name: 'Курганская область' },
  { code: '4600000000000', name: 'Курская область' },
  { code: '9400000000000', name: 'Луганская Народная Республика' },
  { code: '4700000000000', name: 'Ленинградская область' },
  { code: '4800000000000', name: 'Липецкая область' },
  { code: '4900000000000', name: 'Магаданская область' },
  { code: '7700000000000', name: 'Москва' },
  { code: '5000000000000', name: 'Московская область' },
  { code: '5100000000000', name: 'Мурманская область' },
  { code: '8300000000000', name: 'Ненецкий АО' },
  { code: '5200000000000', name: 'Нижегородская область' },
  { code: '5300000000000', name: 'Новгородская область' },
  { code: '5400000000000', name: 'Новосибирская область' },
  { code: '5500000000000', name: 'Омская область' },
  { code: '5600000000000', name: 'Оренбургская область' },
  { code: '5700000000000', name: 'Орловская область' },
  { code: '5800000000000', name: 'Пензенская область' },
  { code: '5900000000000', name: 'Пермский край' },
  { code: '2500000000000', name: 'Приморский край' },
  { code: '6000000000000', name: 'Псковская область' },
  { code: '0100000000000', name: 'Республика Адыгея' },
  { code: '0400000000000', name: 'Республика Алтай' },
  { code: '0300000000000', name: 'Республика Бурятия' },
  { code: '0200000000000', name: 'Республика Башкортостан' },
  { code: '0500000000000', name: 'Республика Дагестан' },
  { code: '0600000000000', name: 'Республика Ингушетия' },
  { code: '0800000000000', name: 'Республика Калмыкия' },
  { code: '1000000000000', name: 'Республика Карелия' },
  { code: '1100000000000', name: 'Республика Коми' },
  { code: '9100000000000', name: 'Республика Крым' },
  { code: '1200000000000', name: 'Республика Марий Эл' },
  { code: '1300000000000', name: 'Республика Мордовия' },
  { code: '1400000000000', name: 'Республика Саха (Якутия)' },
  { code: '1500000000000', name: 'Республика Северная Осетия-Алания' },
  { code: '1600000000000', name: 'Республика Татарстан' },
  { code: '1700000000000', name: 'Республика Тыва' },
  { code: '1900000000000', name: 'Республика Хакасия' },
  { code: '6100000000000', name: 'Ростовская область' },
  { code: '6200000000000', name: 'Рязанская область' },
  { code: '6300000000000', name: 'Самарская область' },
  { code: '7800000000000', name: 'Санкт-Петербург' },
  { code: '6400000000000', name: 'Саратовская область' },
  { code: '6500000000000', name: 'Сахалинская область' },
  { code: '9200000000000', name: 'Севастополь' },
  { code: '6600000000000', name: 'Свердловская область' },
  { code: '6700000000000', name: 'Смоленская область' },
  { code: '2600000000000', name: 'Ставропольский край' },
  { code: '6800000000000', name: 'Тамбовская область' },
  { code: '6900000000000', name: 'Тверская область' },
  { code: '7000000000000', name: 'Томская область' },
  { code: '7100000000000', name: 'Тульская область' },
  { code: '7200000000000', name: 'Тюменская область' },
  { code: '1800000000000', name: 'Удмуртская Республика' },
  { code: '7300000000000', name: 'Ульяновская область' },
  { code: '2700000000000', name: 'Хабаровский край' },
  { code: '8600000000000', name: 'Ханты-Мансийский АО - Югра' },
  { code: '9500000000000', name: 'Херсонская область' },
  { code: '7400000000000', name: 'Челябинская область' },
  { code: '2000000000000', name: 'Чеченская Республика' },
  { code: '2100000000000', name: 'Чувашская Республика' },
  { code: '8700000000000', name: 'Чукотский АО' },
  { code: '7500000000000', name: 'Забайкальский край' },
  { code: '8900000000000', name: 'Ямало-Ненецкий АО' },
  { code: '7600000000000', name: 'Ярославская область' },
  { code: '9000000000000', name: 'Запорожская область' },
  { code: '9900000000000', name: 'Байконур' },
]

export interface VacancySnapshot {
  fetched_at: string   // ISO timestamp — every claim in the generated text traces back to this moment
  regions:    RegionSnapshot[]
}

interface TrudvsemVacancy {
  vacancy: {
    'job-name':     string
    salary?:        string | null
    vac_url:        string
    'creation-date': string
    company: { name: string }
  }
}
interface TrudvsemResponse {
  meta:    { total: number }
  results: { vacancies: TrudvsemVacancy[] }
}

/**
 * Fetch dated vacancy snapshots for each (region × profession term) pair.
 * Sequential (not parallel) — same rate-limit-friendly reasoning as
 * yandexVision.ts's sequential OCR chunking: predictable request pacing,
 * and this only runs once per generation, not in a hot path. Fails soft
 * per-term (a bad/empty term returns total:0, not an aborted snapshot) so
 * one mistyped profession, or one region with no matches, doesn't lose
 * the rest of the snapshot.
 */
export async function fetchVacancySnapshot(
  regionCodes: string[],
  professions: string[]
): Promise<VacancySnapshot> {
  const terms = professions.map((t) => t.trim()).filter(Boolean)

  const regions: RegionSnapshot[] = []
  for (const regionCode of regionCodes) {
    const region = SUPPORTED_REGIONS.find((r) => r.code === regionCode)
    const region_name = region?.name ?? regionCode
    const by_profession: ProfessionSnapshot[] = []
    for (const term of terms) {
      by_profession.push(await fetchOneProfession(regionCode, term))
    }
    regions.push({ region_code: regionCode, region_name, by_profession })
  }

  return { fetched_at: new Date().toISOString(), regions }
}

async function fetchOneProfession(regionCode: string, term: string): Promise<ProfessionSnapshot> {
  const url = `${TRUDVSEM_BASE}/vacancies/region/${regionCode}?text=${encodeURIComponent(term)}&limit=${SAMPLES_PER_TERM}`
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    let response: Response
    try {
      response = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    if (!response.ok) {
      logger.warn({ message: 'trudvsem request failed', term, status: response.status })
      return { term, total: 0, sample: [] }
    }
    const data = await response.json() as TrudvsemResponse
    const sample: SampleVacancy[] = (data.results?.vacancies ?? []).map((v) => ({
      title:    v.vacancy['job-name'],
      employer: v.vacancy.company?.name ?? '',
      salary:   v.vacancy.salary ?? null,
      url:      v.vacancy.vac_url,
      date:     v.vacancy['creation-date'],
    }))
    return { term, total: data.meta?.total ?? 0, sample }
  } catch (err) {
    logger.warn({ message: 'trudvsem request errored', term, error: (err as Error).message })
    return { term, total: 0, sample: [] }
  }
}
