import { describe, it, expect } from 'vitest'
import { generateFosDocx } from './fosExport'
import { checkFosStructure } from './fosStructure'
import { checkFosScores } from './assessmentLinkage'
import {
  buildScoreTable, buildCatalogue, buildGradingScale, buildCompetencyMap,
  buildTitlePage, distributePoints, instrumentsFromBrs,
} from './fosMacketSections'
import type {
  BrsScoreRow, FosDocument, FosSections, FosInstrumentCriteria, FosCriteriaBlock,
} from '../../../shared/types'

// What parseFosNumbers would read back out of the rendered document: the
// itemised components collapsed to the sums the checker compares. Passing the
// generator's own shape straight in leaves component_min/max undefined, which
// silently skips the sum rules — the test then proves nothing.
const asBlocks = (cs: FosInstrumentCriteria[]): FosCriteriaBlock[] =>
  cs.map((c) => ({
    instrument: c.instrument,
    declared_min: c.declared_min, declared_max: c.declared_max,
    component_min: c.components.reduce((n, p) => n + (p.min ?? 0), 0),
    component_max: c.components.reduce((n, p) => n + (p.max ?? 0), 0),
  }))

// The point of the макет work: a generated ФОС should satisfy
// services/fosStructure.ts and the ФОС↔§9 arithmetic BY CONSTRUCTION, not by
// being checked afterwards. These tests close that loop — build a document,
// render it, read the text back, and run the very checks a методист would.

const BRS: BrsScoreRow[] = [
  { name: 'Лабораторная работа', semester: '1-й семестр', min_points: 12, max_points: 20 },
  { name: 'Контрольная работа',  semester: '1-й семестр', min_points: 18, max_points: 30 },
  { name: 'Реферат',             semester: '1-й семестр', min_points: 6,  max_points: 10 },
  { name: 'Экзамен',             semester: '1-й семестр', min_points: 24, max_points: 40 },
]

function criteriaFor(items: BrsScoreRow[]): FosInstrumentCriteria[] {
  // Mirrors buildInstrumentCriteria's distribution without the LLM call.
  return instrumentsFromBrs(items).map((r) => {
    const labels = ['Полнота выполнения', 'Оформление', 'Защита результата']
    const mins = distributePoints(r.min_points, labels.length)
    const maxes = distributePoints(r.max_points, labels.length)
    return {
      instrument: r.name,
      components: labels.map((label, i) => ({ label, min: mins[i], max: maxes[i] })),
      declared_min: r.min_points, declared_max: r.max_points,
    }
  })
}

function sections(overrides: Partial<FosSections> = {}): FosSections {
  return {
    passport: { competencies: ['ОПК-4.1'], topics: ['Тема 1', 'Тема 2'], rows: [] },
    quiz_ids: [], task_sets: [], tickets: [], criteria: [],
    title_page:     buildTitlePage('Метрология'),
    competency_map: buildCompetencyMap(['ОПК-4.1'], ['Тема 1', 'Тема 2'], instrumentsFromBrs(BRS).map((r) => r.name)),
    score_table:    buildScoreTable(BRS),
    grading_scale:  buildGradingScale(),
    catalogue:      buildCatalogue(BRS),
    instrument_criteria: criteriaFor(BRS),
    ...overrides,
  }
}

function fosDoc(s: FosSections): FosDocument {
  return {
    id: 'f1', course_id: 'c1', status: 'ready', progress_done: 8, progress_total: 8,
    sections: s, coverage: null, created_at: new Date().toISOString(),
  } as unknown as FosDocument
}

// docx → text, the same shape services/documentExtractor.ts yields.
async function docxToText(buf: Buffer): Promise<string> {
  const mammoth = await import('mammoth')
  const { value } = await mammoth.extractRawText({ buffer: buf })
  return value
}

describe('generated ФОС conforms to the макет by construction', () => {
  it('passes the structural check a методист would run against it', async () => {
    const text = await docxToText(await generateFosDocx(fosDoc(sections()), 'Метрология'))
    const result = checkFosStructure(text, BRS)

    expect(result.checked).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.present).toHaveLength(8)
  }, 30_000)

  it('emits a перечень whose numbers reconcile with §9 with nothing to report', () => {
    const rows = buildScoreTable(BRS).map((r) => ({ ...r, count: null }))
    const result = checkFosScores(BRS, rows, asBlocks(criteriaFor(BRS)))
    expect(result.findings).toEqual([])
  })

  it('prints the макет note that the перечень comes from п.9', async () => {
    const text = await docxToText(await generateFosDocx(fosDoc(sections()), 'Метрология'))
    expect(text).toMatch(/приводиться из п\.9 рабочей программы/)
  }, 30_000)

  // The макет makes СОГЛАСОВАНО conditional; printing it on every generated
  // ФОС would put a block on documents that must not carry one.
  it('does not print СОГЛАСОВАНО, which only some kafedras include', async () => {
    const text = await docxToText(await generateFosDocx(fosDoc(sections()), 'Метрология'))
    expect(text).not.toMatch(/СОГЛАСОВАНО/)
  }, 30_000)

  it('still renders — without макет blocks — for ФОС generated before this shipped', async () => {
    const legacy: FosSections = {
      passport: { competencies: [], topics: ['Тема 1'], rows: [] },
      quiz_ids: [], task_sets: [], tickets: [], criteria: [],
    }
    const text = await docxToText(await generateFosDocx(fosDoc(legacy), 'Метрология'))
    expect(text).toMatch(/ФОНД ОЦЕНОЧНЫХ СРЕДСТВ/)
  }, 30_000)
})

describe('buildScoreTable / distributePoints', () => {
  it('reproduces §9 verbatim and adds the per-semester Итого the макет prints', () => {
    const rows = buildScoreTable(BRS)
    const total = rows.find((r) => r.name === 'Итого:')!
    expect(total.min_points).toBe(60)
    expect(total.max_points).toBe(100)
  })

  it('keeps semesters separate, each with its own Итого', () => {
    const twoSem = [...BRS, ...BRS.map((r) => ({ ...r, semester: '2-й семестр' }))]
    const totals = buildScoreTable(twoSem).filter((r) => r.name === 'Итого:')
    expect(totals).toHaveLength(2)
    expect(totals.every((t) => t.max_points === 100)).toBe(true)
  })

  it('distributes points so the parts always sum back to the total', () => {
    for (const [total, n] of [[20, 3], [10, 3], [7, 4], [100, 6], [1, 3]] as const) {
      const parts = distributePoints(total, n)
      expect(parts.reduce((a, b) => (a ?? 0) + (b ?? 0), 0)).toBe(total)
    }
  })

  it('yields nulls rather than zeros when §9 gave no number', () => {
    expect(distributePoints(null, 3)).toEqual([null, null, null])
  })

  it('only catalogues instruments the макет actually describes', () => {
    const cat = buildCatalogue([...BRS, { name: 'Коллоквиум по метрологии', semester: null, min_points: 1, max_points: 2 }])
    expect(cat.some((r) => /Лабораторная работа/.test(r.name))).toBe(true)
    expect(cat.every((r) => r.description.length > 0)).toBe(true)
  })
})
