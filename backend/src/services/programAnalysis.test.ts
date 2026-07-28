import { describe, it, expect } from 'vitest'
import {
  deriveStructure, deriveOutcomeDelivery, deriveMappingConfidence, deriveLoadCheck, deriveContentConfidence,
  resolveSequencingEdges,
} from './programAnalysis'
import type { PrerequisiteEdge, ProgramDiscipline, CompetencyProgressionRow, SemesterLoad } from '../../../shared/types'

const sem = (semester: number, credits: number | null): SemesterLoad => ({ semester, discipline_count: 1, credits })

const row = (status: CompetencyProgressionRow['status']): CompetencyProgressionRow =>
  ({ kind: 'competency', code: 'X', title: 'x', cells: [], status, note: '' })

const disc = (name: string, semester: number, id?: string): ProgramDiscipline =>
  ({ id, name, semester, course_id: null, credits: null, control_form: null, competency_codes: [], sort_order: 0 })

const edge = (from: string, fromSem: number, to: string, toSem: number): PrerequisiteEdge =>
  ({ from_name: from, from_semester: fromSem, to_name: to, to_semester: toSem, reason: '', inverted: toSem < fromSem, recommendation: '' })

describe('deriveStructure', () => {
  it('layers disciplines by dependency depth (foundational → professional)', () => {
    // Мат(1) → Механика(3) → Сопромат(5); Физика(1) → Механика(3)
    const disciplines = [disc('Математика', 1), disc('Физика', 1), disc('Механика', 3), disc('Сопромат', 5), disc('История', 1)]
    const edges = [edge('Математика', 1, 'Механика', 3), edge('Физика', 1, 'Механика', 3), edge('Механика', 3, 'Сопромат', 5)]
    const s = deriveStructure(edges, disciplines)

    const layer = (d: number) => s.layers.find((l) => l.depth === d)?.disciplines.map((x) => x.name).sort() ?? []
    expect(layer(0)).toEqual(['Математика', 'Физика'])   // no prerequisites
    expect(layer(1)).toEqual(['Механика'])               // depends on layer-0
    expect(layer(2)).toEqual(['Сопромат'])               // depends on layer-1
  })

  it('finds the longest prerequisite chain (spine)', () => {
    const disciplines = [disc('A', 1), disc('B', 2), disc('C', 3), disc('D', 4)]
    const edges = [edge('A', 1, 'B', 2), edge('B', 2, 'C', 3), edge('C', 3, 'D', 4)]
    const s = deriveStructure(edges, disciplines)
    expect(s.longest_chains[0].names).toEqual(['A', 'B', 'C', 'D'])
    expect(s.longest_chains[0].length).toBe(4)
  })

  it('does not report chains shorter than 3', () => {
    const s = deriveStructure([edge('A', 1, 'B', 2)], [disc('A', 1), disc('B', 2)])
    expect(s.longest_chains).toHaveLength(0)
  })

  it('lists disciplines outside the dependency graph as isolated', () => {
    const disciplines = [disc('Математика', 1), disc('Физика', 2), disc('Философия', 3)]
    const edges = [edge('Математика', 1, 'Физика', 2)]
    const s = deriveStructure(edges, disciplines)
    expect(s.isolated.map((x) => x.name)).toEqual(['Философия'])
  })

  it('is cycle-safe (a stray back-edge does not hang)', () => {
    const disciplines = [disc('A', 1), disc('B', 2), disc('C', 3)]
    const edges = [edge('A', 1, 'B', 2), edge('B', 2, 'C', 3), edge('C', 3, 'A', 1)]   // cycle
    const s = deriveStructure(edges, disciplines)
    expect(s.layers.length).toBeGreaterThan(0)   // returns something rather than looping
    expect(s.isolated).toHaveLength(0)
  })

  it('empty edges → empty structure', () => {
    const s = deriveStructure([], [disc('A', 1)])
    expect(s.layers).toHaveLength(0)
    expect(s.longest_chains).toHaveLength(0)
    expect(s.isolated.map((x) => x.name)).toEqual(['A'])
  })
})

describe('resolveSequencingEdges', () => {
  it('resolves both endpoints to their program_disciplines.id', () => {
    const disciplines = [disc('Математика', 1, 'd1'), disc('Механика', 3, 'd2')]
    const { edges, unmatchedNames } = resolveSequencingEdges(
      [{ from: 'Математика', to: 'Механика', reason: 'основа' }], disciplines
    )
    expect(edges).toHaveLength(1)
    expect(edges[0]).toMatchObject({ from_id: 'd1', to_id: 'd2', from_name: 'Математика', to_name: 'Механика' })
    expect(unmatchedNames).toEqual([])
  })

  it('matches by normalized name (case/whitespace-insensitive) same as before', () => {
    const disciplines = [disc('Математика', 1, 'd1'), disc('Механика', 3, 'd2')]
    const { edges } = resolveSequencingEdges(
      [{ from: '  математика  ', to: 'МЕХАНИКА', reason: '' }], disciplines
    )
    expect(edges).toHaveLength(1)
    expect(edges[0].from_id).toBe('d1')
    expect(edges[0].to_id).toBe('d2')
  })

  it('surfaces an unmatched endpoint instead of silently dropping it', () => {
    const disciplines = [disc('Математика', 1, 'd1')]
    const { edges, unmatchedNames } = resolveSequencingEdges(
      [{ from: 'Математика', to: 'Несуществующая дисциплина', reason: '' }], disciplines
    )
    expect(edges).toHaveLength(0)
    expect(unmatchedNames).toEqual(['Несуществующая дисциплина'])
  })

  it('still resolves an edge even when a discipline has no id (id is optional, name matching still works)', () => {
    const disciplines = [disc('Математика', 1), disc('Механика', 3)]   // no ids — e.g. an unsaved draft plan
    const { edges, unmatchedNames } = resolveSequencingEdges(
      [{ from: 'Математика', to: 'Механика', reason: '' }], disciplines
    )
    expect(edges).toHaveLength(1)
    expect(edges[0].from_id).toBeUndefined()
    expect(edges[0].to_id).toBeUndefined()
    expect(unmatchedNames).toEqual([])
  })

  it('dedups repeated pairs', () => {
    const disciplines = [disc('A', 1, 'd1'), disc('B', 2, 'd2')]
    const { edges } = resolveSequencingEdges(
      [{ from: 'A', to: 'B', reason: 'x' }, { from: 'A', to: 'B', reason: 'y' }], disciplines
    )
    expect(edges).toHaveLength(1)
  })

  it('flags inverted edges (dependent taught earlier than its prerequisite)', () => {
    const disciplines = [disc('A', 3, 'd1'), disc('B', 1, 'd2')]
    const { edges } = resolveSequencingEdges([{ from: 'A', to: 'B', reason: '' }], disciplines)
    expect(edges[0].inverted).toBe(true)
  })
})

describe('deriveOutcomeDelivery', () => {
  it('all ok → delivered, score 100', () => {
    const d = deriveOutcomeDelivery([row('ok'), row('ok')])!
    expect(d.verdict).toBe('delivered')
    expect(d.score).toBe(100)
    expect(d.fully).toBe(2)
  })
  it('any uncovered → gaps verdict', () => {
    const d = deriveOutcomeDelivery([row('ok'), row('ok'), row('uncovered')])!
    expect(d.verdict).toBe('gaps')
    expect(d.uncovered).toBe(1)
  })
  it('thin/late but none uncovered → partial', () => {
    const d = deriveOutcomeDelivery([row('ok'), row('thin'), row('late')])!
    expect(d.verdict).toBe('partial')
    expect(d.thin).toBe(1)
    expect(d.late).toBe(1)
  })
  it('score gives thin/late 0.6 weight', () => {
    // 1 ok (1.0) + 1 thin (0.6) = 1.6 / 2 = 0.8 → 80
    expect(deriveOutcomeDelivery([row('ok'), row('thin')])!.score).toBe(80)
    // all uncovered → 0
    expect(deriveOutcomeDelivery([row('uncovered'), row('uncovered')])!.score).toBe(0)
  })
  it('counts total across all statuses', () => {
    const d = deriveOutcomeDelivery([row('ok'), row('thin'), row('late'), row('uncovered')])!
    expect(d.total).toBe(4)
  })
  it('no competency data → undefined', () => {
    expect(deriveOutcomeDelivery([])).toBeUndefined()
  })
})

describe('deriveMappingConfidence', () => {
  const withCodes = (codes: string[]): ProgramDiscipline => ({ ...disc('x', 1), competency_codes: codes })

  it('low when under half the disciplines declare codes', () => {
    const m = deriveMappingConfidence([withCodes(['УК-1']), withCodes([]), withCodes([])])
    expect(m.low).toBe(true)
    expect(m.disciplines_with_codes).toBe(1)
    expect(m.disciplines_total).toBe(3)
  })
  it('not low when at least half declare codes', () => {
    expect(deriveMappingConfidence([withCodes(['УК-1']), withCodes([])]).low).toBe(false)   // 1/2 = 0.5, not < 0.5
    expect(deriveMappingConfidence([withCodes(['УК-1']), withCodes(['ОПК-2'])]).low).toBe(false)
  })
  it('empty plan is not flagged low', () => {
    expect(deriveMappingConfidence([]).low).toBe(false)
  })
})

describe('deriveContentConfidence', () => {
  const withId = (id: string): ProgramDiscipline => ({ ...disc('x', 1), id })

  it('low when under half the disciplines have real uploaded content', () => {
    const docs = new Map([['a', 'x'.repeat(200)]])   // only discipline "a" has real content
    const c = deriveContentConfidence([withId('a'), withId('b'), withId('c')], docs)
    expect(c.low).toBe(true)
    expect(c.disciplines_with_content).toBe(1)
    expect(c.disciplines_total).toBe(3)
  })
  it('not low when at least half have real content', () => {
    const docs = new Map([['a', 'x'.repeat(200)], ['b', 'y'.repeat(200)]])
    expect(deriveContentConfidence([withId('a'), withId('b')], docs).low).toBe(false)
  })
  it('a doc under the 80-char threshold does not count as real content', () => {
    const docs = new Map([['a', 'short']])
    const c = deriveContentConfidence([withId('a'), withId('b')], docs)
    expect(c.disciplines_with_content).toBe(0)
    expect(c.low).toBe(true)
  })
  it('empty plan is not flagged low', () => {
    expect(deriveContentConfidence([], new Map()).low).toBe(false)
  })
})

describe('deriveLoadCheck', () => {
  // A clean 2-year plan: 30+30 / 30+30 = 120, expected 60×2.
  const clean = [sem(1, 30), sem(2, 30), sem(3, 30), sem(4, 30)]

  it('no issues when totals match the 60-per-year rule', () => {
    const c = deriveLoadCheck(clean, [], 4)
    expect(c.issues).toHaveLength(0)
    expect(c.total_credits).toBe(120)
    expect(c.expected_total).toBe(120)
  })

  it('flags a total short of 60×years (missing tail)', () => {
    // 47+19 / 23+26 = 115 over 2 years → expected 120 (within 6? 5 → no). Use a bigger miss.
    const short = [sem(1, 47), sem(2, 19), sem(3, 23), sem(4, 11)]   // 100 vs 120
    const c = deriveLoadCheck(short, [], 4)
    expect(c.issues.some((i) => i.includes('вместо ожидаемых 120'))).toBe(true)
  })

  it('flags per-year deviation from 60', () => {
    const skew = [sem(1, 47), sem(2, 19), sem(3, 30), sem(4, 30)]   // year1 = 66
    const c = deriveLoadCheck(skew, [], 4)
    expect(c.issues.some((i) => i.startsWith('Год 1') && i.includes('66'))).toBe(true)
  })

  it('flags disciplines without ЗЕТ', () => {
    const disc = (credits: number | null): ProgramDiscipline =>
      ({ name: 'x', semester: 1, course_id: null, credits, control_form: null, competency_codes: [], sort_order: 0 })
    const c = deriveLoadCheck(clean, [disc(30), disc(null), disc(null)], 4)
    expect(c.disciplines_without_credits).toBe(2)
    expect(c.issues.some((i) => i.includes('без ЗЕТ'))).toBe(true)
  })

  it('does not flag a year when a semester has no credit data', () => {
    const partial = [sem(1, 30), sem(2, null), sem(3, 30), sem(4, 30)]
    const c = deriveLoadCheck(partial, [], 4)
    expect(c.issues.some((i) => i.startsWith('Год 1'))).toBe(false)   // year 1 skipped (null sem)
  })

  it('reconciles per-semester extracted sums against Итого rows and flags mismatches', () => {
    const load = [sem(1, 47), sem(2, 19), sem(3, 30), sem(4, 30)]
    // Plan itself says sem 1 was 30 and sem 2 was 30 (i.e. the extraction dumped sem 2 into sem 1).
    const totals = { 1: 30, 2: 30, 3: 30, 4: 30 }
    const c = deriveLoadCheck(load, [], 4, totals)
    expect(c.issues.some((i) => i.startsWith('Сем. 1') && i.includes('47') && i.includes('30'))).toBe(true)
    expect(c.issues.some((i) => i.startsWith('Сем. 2') && i.includes('19') && i.includes('30'))).toBe(true)
    // Sems 3 and 4 match, so no issue for them.
    expect(c.issues.some((i) => i.startsWith('Сем. 3'))).toBe(false)
  })

  it('does not flag a semester within the Итого tolerance', () => {
    const load = [sem(1, 30), sem(2, 30.5)]                // 0.5 з.е. rounding
    const c = deriveLoadCheck(load, [], 2, { 1: 30, 2: 30 })
    expect(c.issues.some((i) => i.startsWith('Сем.'))).toBe(false)
  })

  it('ignores Итого reconciliation when no totals were extracted (legacy import)', () => {
    // Same skewed load as above; without totals, only per-year flags fire.
    const load = [sem(1, 47), sem(2, 19), sem(3, 30), sem(4, 30)]
    const c = deriveLoadCheck(load, [], 4)
    expect(c.issues.some((i) => i.startsWith('Сем.'))).toBe(false)   // no Итого issues
  })
})
