import { describe, it, expect } from 'vitest'
import { checkBrsReadiness } from './brsReadiness'
import { allocateBrsPoints, buildBrsSection } from './syllabusAuthor'
import { BRS_SEMESTER_MIN, BRS_SEMESTER_MAX } from '../config/brs'
import type { BrsScoreRow } from '../../../shared/types'

const row = (name: string, min: number | null, max: number | null, semester: string | null = null): BrsScoreRow =>
  ({ name, semester, min_points: min, max_points: max })

// A correct §9: КНИТУ's 60/100 per semester, every point filled in.
const GOOD: BrsScoreRow[] = [
  row('Лабораторная работа', 12, 20),
  row('Контрольная работа', 18, 30),
  row('Реферат', 6, 10),
  row('Экзамен', 24, 40),
]

describe('checkBrsReadiness', () => {
  it('passes a §9 that totals 60/100 with every point filled in', () => {
    const result = checkBrsReadiness(GOOD)
    expect(result.checked).toBe(true)
    expect(result.ready).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/можно собрать ФОС/)
  })

  it('says there is nothing to check when §9 has no rows', () => {
    const result = checkBrsReadiness([])
    expect(result.checked).toBe(false)
    expect(result.ready).toBe(false)
  })

  it('blocks on a row missing its minimum', () => {
    const result = checkBrsReadiness([row('Лабораторная работа', null, 20), row('Экзамен', 24, 40)])
    const f = result.findings.find((x) => x.kind === 'missing_points')!
    expect(f.severity).toBe('error')
    expect(f.detail).toMatch(/не указан минимальный балл/)
    expect(result.ready).toBe(false)
  })

  // Otherwise an incomplete row produces two findings — one true, one about a
  // total that was never fully written down.
  it('does not also report a total for a semester with an incomplete row', () => {
    const result = checkBrsReadiness([row('Лабораторная работа', null, 20), row('Экзамен', 24, 40)])
    expect(result.findings.filter((f) => f.kind === 'semester_total')).toEqual([])
  })

  it('blocks when a minimum is above its maximum', () => {
    const result = checkBrsReadiness([row('Реферат', 30, 10), row('Экзамен', 30, 90)])
    expect(result.findings.some((f) => f.kind === 'min_above_max')).toBe(true)
  })

  it('blocks a semester that does not add up to 60/100', () => {
    const result = checkBrsReadiness([row('Реферат', 10, 20), row('Экзамен', 24, 40)])
    const f = result.findings.find((x) => x.kind === 'semester_total')!
    expect(f.severity).toBe('error')
    expect(f.detail).toMatch(/34\/60/)
    expect(result.ready).toBe(false)
  })

  it('applies the total per semester, not across the discipline', () => {
    const two = [...GOOD, ...GOOD.map((r) => ({ ...r, semester: '2-й семестр' }))]
      .map((r, i) => (i < GOOD.length ? { ...r, semester: '1-й семестр' } : r))
    expect(checkBrsReadiness(two).ready).toBe(true)
  })

  // A кафедра may legitimately use an instrument the макет never listed; it
  // only means the ФОС will need a hand-written description. Note the matcher
  // is stem-aware, so «Защита портфолио проектов» would NOT qualify — it
  // resolves to the catalogue's «Портфолио».
  it('warns — but does not block — on an instrument the макет does not list', () => {
    const result = checkBrsReadiness([
      row('Лабораторная работа', 12, 20), row('Контрольная работа', 18, 30),
      row('Реферат', 6, 10), row('Ведение журнала наблюдений', 24, 40),
    ])
    const f = result.findings.find((x) => x.kind === 'unknown_instrument')!
    expect(f.severity).toBe('warning')
    expect(result.ready).toBe(true)
  })

  it('ignores «Итого» rows rather than treating them as a control point', () => {
    expect(checkBrsReadiness([...GOOD, row('Итого:', 60, 100)]).ready).toBe(true)
  })
})

describe('РПД студия — §9 drafted so it already adds up', () => {
  it('allocates exactly 60/100 across the declared instruments', () => {
    const names = ['Лабораторная работа', 'Контрольная работа', 'Реферат', 'Экзамен']
    const rows = allocateBrsPoints(names, names.indexOf('Экзамен'))
    expect(rows.reduce((n, r) => n + r.min, 0)).toBe(BRS_SEMESTER_MIN)
    expect(rows.reduce((n, r) => n + r.max, 0)).toBe(BRS_SEMESTER_MAX)
  })

  it('still totals exactly when the split is not even', () => {
    for (const n of [1, 2, 3, 5, 7, 11]) {
      const names = Array.from({ length: n }, (_, i) => `Средство ${i + 1}`)
      const rows = allocateBrsPoints(names, -1)
      expect(rows.reduce((a, r) => a + r.min, 0)).toBe(BRS_SEMESTER_MIN)
      expect(rows.reduce((a, r) => a + r.max, 0)).toBe(BRS_SEMESTER_MAX)
    }
  })

  it('weights промежуточная аттестация at roughly the макет\'s share', () => {
    const names = ['Лабораторная работа', 'Экзамен']
    const rows = allocateBrsPoints(names, 1)
    expect(rows[1].max).toBe(40)   // макет: экзамен 24/40 of 60/100
    expect(rows[1].min).toBe(24)
  })

  it('produces a §9 section whose own numbers pass the readiness check', () => {
    const section = buildBrsSection(['Лабораторная работа', 'Контрольная работа', 'Экзамен'])!
    expect(section.heading).toMatch(/рейтинговой системы/)

    // Read the drafted table back the way a parse would, then check it.
    const rows: BrsScoreRow[] = section.content
      .split('\n')
      .filter((l) => l.includes('|') && !/Оценочные средства/.test(l))
      .map((l) => l.split('|').map((s) => s.trim()))
      .map(([name, , min, max]) => row(name, Number(min), Number(max)))

    expect(checkBrsReadiness(rows).ready).toBe(true)
  })

  it('returns nothing when the draft declared no instruments', () => {
    expect(buildBrsSection([])).toBeNull()
  })
})

describe('catalogue matching', () => {
  // Промежуточная аттестация is absent from the макет's catalogue by design —
  // it gets an экзаменационный билет instead of a «краткая характеристика»
  // row. Checking it against that list would flag nearly every РПД.
  it('never reports экзамен or зачёт as an unlisted instrument', () => {
    for (const name of ['Экзамен', 'Зачет', 'Зачёт', 'Зачет с оценкой']) {
      const result = checkBrsReadiness([row('Лабораторная работа', 36, 60), row(name, 24, 40)])
      expect(result.findings.filter((f) => f.kind === 'unknown_instrument')).toEqual([])
    }
  })

  it('resolves an instrument named more verbosely than the catalogue entry', () => {
    const result = checkBrsReadiness([row('Защита портфолио проектов', 36, 60), row('Экзамен', 24, 40)])
    expect(result.findings.filter((f) => f.kind === 'unknown_instrument')).toEqual([])
  })
})
