import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fetchVacancySnapshot, SUPPORTED_REGIONS } from './labourMarket'

const TATARSTAN_CODE = SUPPORTED_REGIONS.find((r) => r.name === 'Республика Татарстан')!.code

function trudvsemResponse(total: number, jobName = 'Инженер-технолог') {
  return {
    meta: { total },
    results: {
      vacancies: total > 0 ? [{
        vacancy: {
          'job-name': jobName,
          salary: 'от 85000',
          vac_url: 'https://trudvsem.ru/vacancy/card/1/abc',
          'creation-date': '2026-06-17',
          company: { name: 'АО «ТАИФ-НК»' },
        },
      }] : [],
    },
  }
}

describe('fetchVacancySnapshot', () => {
  const fetchMock = vi.fn()
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset() })
  afterEach(() => { vi.unstubAllGlobals() })

  it('fetches a snapshot per profession term within one region, sequentially', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => trudvsemResponse(86) })
      .mockResolvedValueOnce({ ok: true, json: async () => trudvsemResponse(12, 'Технолог') })

    const snapshot = await fetchVacancySnapshot([TATARSTAN_CODE], ['инженер-технолог', 'технолог'])

    expect(snapshot.regions).toHaveLength(1)
    expect(snapshot.regions[0].region_name).toBe('Республика Татарстан')
    expect(snapshot.regions[0].by_profession).toHaveLength(2)
    expect(snapshot.regions[0].by_profession[0]).toMatchObject({ term: 'инженер-технолог', total: 86 })
    expect(snapshot.regions[0].by_profession[0].sample[0]).toMatchObject({
      title: 'Инженер-технолог', employer: 'АО «ТАИФ-НК»', salary: 'от 85000',
    })
    expect(snapshot.regions[0].by_profession[1]).toMatchObject({ term: 'технолог', total: 12 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fetches every (region × term) pair across multiple regions', async () => {
    const moscowCode = SUPPORTED_REGIONS.find((r) => r.name === 'Москва')!.code
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => trudvsemResponse(86) })
      .mockResolvedValueOnce({ ok: true, json: async () => trudvsemResponse(300) })

    const snapshot = await fetchVacancySnapshot([TATARSTAN_CODE, moscowCode], ['инженер-технолог'])

    expect(snapshot.regions).toHaveLength(2)
    expect(snapshot.regions[0]).toMatchObject({ region_name: 'Республика Татарстан' })
    expect(snapshot.regions[0].by_profession[0].total).toBe(86)
    expect(snapshot.regions[1]).toMatchObject({ region_name: 'Москва' })
    expect(snapshot.regions[1].by_profession[0].total).toBe(300)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails soft for a single bad term instead of aborting the whole snapshot', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, json: async () => trudvsemResponse(20) })

    const snapshot = await fetchVacancySnapshot([TATARSTAN_CODE], ['bad term', 'инженер-технолог'])

    expect(snapshot.regions[0].by_profession[0]).toMatchObject({ term: 'bad term', total: 0, sample: [] })
    expect(snapshot.regions[0].by_profession[1]).toMatchObject({ total: 20 })
  })

  it('fails soft when fetch itself throws (network error)', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'))
    const snapshot = await fetchVacancySnapshot([TATARSTAN_CODE], ['инженер'])
    expect(snapshot.regions[0].by_profession[0]).toMatchObject({ term: 'инженер', total: 0, sample: [] })
  })

  it('skips blank/whitespace-only terms without calling fetch', async () => {
    const snapshot = await fetchVacancySnapshot([TATARSTAN_CODE], ['', '   '])
    expect(snapshot.regions[0].by_profession).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('falls back to the raw region code as the name for an unrecognized region', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => trudvsemResponse(1) })
    const snapshot = await fetchVacancySnapshot(['9999999999999'], ['инженер'])
    expect(snapshot.regions[0].region_name).toBe('9999999999999')
  })
})

describe('SUPPORTED_REGIONS', () => {
  it('has no duplicate codes or names', () => {
    const codes = SUPPORTED_REGIONS.map((r) => r.code)
    const names = SUPPORTED_REGIONS.map((r) => r.name)
    expect(new Set(codes).size).toBe(codes.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('every code is a 13-digit numeric string (2-digit region prefix + 11 zeros)', () => {
    for (const r of SUPPORTED_REGIONS) {
      expect(r.code).toMatch(/^\d{13}$/)
    }
  })

  it('covers all 89 federal subjects plus Байконур', () => {
    expect(SUPPORTED_REGIONS.length).toBeGreaterThanOrEqual(89)
  })
})
