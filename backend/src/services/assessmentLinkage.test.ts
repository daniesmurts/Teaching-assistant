import { describe, it, expect, vi } from 'vitest'
import { checkAssessmentLinkage, mentions, parseAssessmentLinkage, checkFosScores } from './assessmentLinkage'
import type {
  ParsedAssessmentLinkage, BrsScoreRow, FosScoreRow, FosCriteriaBlock,
} from '../../../shared/types'

const { chatJSONMock } = vi.hoisted(() => ({ chatJSONMock: vi.fn() }))
vi.mock('./deepseek', () => ({ chatJSON: chatJSONMock }))

// The worked example is the методист's own, verbatim from her report
// (2026-08-20): «если в п.4 есть оценочное средство "ДОКЛАД", то в СРС должно
// быть "ПОДГОТОВКА ДОКЛАДА", в КСР — "ЗАСЛУШИВАНИЕ ДОКЛАДА", в п.9 — "ДОКЛАД"
// с баллами».

function parsed(overrides: Partial<ParsedAssessmentLinkage> = {}): ParsedAssessmentLinkage {
  return {
    instruments: [{ name: 'Доклад', section: 'Раздел 1' }],
    srs_forms:   ['Подготовка доклада'],
    ksr_forms:   ['Заслушивание доклада'],
    brs_items:   [{ name: 'Доклад', semester: null, min_points: null, max_points: 10 }],
    ...overrides,
  }
}

describe('checkAssessmentLinkage — the complete chain', () => {
  it('reports no finding when СРС, КСР and п.9 all keep the promise made in п.4', () => {
    const result = checkAssessmentLinkage(parsed())
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/прослеживаются/)
  })

  // Even a clean pass must not imply the ФОС was checked — it is a separate
  // document and this check never reads it.
  it('always says the ФОС still needs checking by hand, even when the chain is complete', () => {
    expect(checkAssessmentLinkage(parsed()).summary).toMatch(/ФОС/)
  })
})

describe('checkAssessmentLinkage — broken links', () => {
  it('flags an instrument that never appears in СРС', () => {
    const result = checkAssessmentLinkage(parsed({ srs_forms: ['Проработка лекционного материала'] }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].missing).toEqual(['srs'])
    expect(result.findings[0].detail).toMatch(/«Доклад» заявлено в п\.4/)
    // The instrument name stays in the nominative — see buildRecommendation.
    expect(result.findings[0].recommendation).toMatch(/Для «Доклад» добавьте в СРС/)
    expect(result.findings[0].recommendation).toMatch(/Образец связки/)
  })

  it('flags an instrument missing from every downstream section', () => {
    const result = checkAssessmentLinkage(parsed({ srs_forms: [], ksr_forms: [], brs_items: [] }))
    expect(result.findings[0].missing).toEqual(['srs', 'ksr', 'brs'])
  })

  it('flags a п.9 entry that names the instrument but carries no points', () => {
    const result = checkAssessmentLinkage(parsed({ brs_items: [{ name: 'Доклад', semester: null, min_points: null, max_points: null }] }))
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].missing).toEqual([])
    expect(result.findings[0].brs_missing_points).toBe(true)
    expect(result.findings[0].detail).toMatch(/без баллов/)
  })

  it('records which phrase satisfied each link, so the reader can verify the match', () => {
    const result = checkAssessmentLinkage(parsed({ ksr_forms: [] }))
    expect(result.findings[0].matched_srs).toBe('Подготовка доклада')
    expect(result.findings[0].matched_ksr).toBeNull()
    expect(result.findings[0].matched_brs).toBe('Доклад')
  })
})

describe('checkAssessmentLinkage — what must NOT be flagged', () => {
  // Requiring «Заслушивание экзамена» in КСР would fire on every correctly
  // written РПД in the institution.
  it('checks промежуточная аттестация against п.9 only, not СРС/КСР', () => {
    const result = checkAssessmentLinkage(parsed({
      instruments: [{ name: 'Экзамен', section: 'Раздел 1' }],
      srs_forms:   [],
      ksr_forms:   [],
      brs_items:   [{ name: 'Экзамен', semester: null, min_points: null, max_points: 40 }],
    }))
    expect(result.findings).toEqual([])
  })

  it('still flags промежуточная аттестация that carries no points in п.9', () => {
    const result = checkAssessmentLinkage(parsed({
      instruments: [{ name: 'Зачёт', section: null }],
      srs_forms:   [], ksr_forms: [],
      brs_items:   [],
    }))
    expect(result.findings[0].missing).toEqual(['brs'])
  })

  // The §4 table repeats the same instrument on every раздел row; reporting
  // «Доклад» once per row would bury the actual signal.
  it('reports a repeated instrument once, not once per раздел row', () => {
    const result = checkAssessmentLinkage(parsed({
      instruments: [
        { name: 'Доклад',  section: 'Раздел 1' },
        { name: 'Доклада', section: 'Раздел 2' },
        { name: 'Доклад',  section: 'Раздел 3' },
      ],
      srs_forms: [], ksr_forms: [], brs_items: [],
    }))
    expect(result.findings).toHaveLength(1)
  })

  it('says so plainly when п.4 declared no assessment instruments at all', () => {
    const result = checkAssessmentLinkage(parsed({ instruments: [] }))
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/не найдено оценочных средств/)
  })
})

describe('checkAssessmentLinkage — with an uploaded ФОС', () => {
  it('reports fos_available: false and never flags a missing ФОС when none was supplied', () => {
    const result = checkAssessmentLinkage(parsed())
    expect(result.fos_available).toBe(false)
    expect(result.findings.every((f) => !f.missing.includes('fos'))).toBe(true)
    expect(result.summary).toMatch(/не загружен/)
  })

  it('confirms an instrument present in the uploaded ФОС, with no finding raised for it', () => {
    const result = checkAssessmentLinkage(parsed(), 'Вопросы к докладу: раскройте тему в устной форме перед группой.')
    expect(result.fos_available).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/ФОС/)
    expect(result.summary).not.toMatch(/не загружен/)
  })

  it('flags an instrument absent from an uploaded ФОС — this is a real failure, not "unverified"', () => {
    const result = checkAssessmentLinkage(parsed(), 'Экзаменационные билеты по всем темам курса, утверждены на заседании кафедры.')
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0].missing).toEqual(['fos'])
    expect(result.findings[0].matched_fos).toBeNull()
    expect(result.findings[0].recommendation).toMatch(/в ФОС — «Доклад»/)
    // Must not ALSO tell the reader to check by hand — it already did.
    expect(result.findings[0].recommendation).not.toMatch(/не был загружен/)
  })

  it('ignores ФОС text under the noise floor as effectively "not uploaded"', () => {
    const result = checkAssessmentLinkage(parsed(), 'см. приложение')
    expect(result.fos_available).toBe(false)
  })

  it('checks промежуточная аттестация against ФОС too, when available', () => {
    const result = checkAssessmentLinkage(parsed({
      instruments: [{ name: 'Экзамен', section: null }],
      srs_forms: [], ksr_forms: [],
      brs_items: [{ name: 'Экзамен', semester: null, min_points: null, max_points: 40 }],
    }), 'Приложение: билеты к зачёту по разделам 1-5.')
    expect(result.findings[0].missing).toEqual(['fos'])
  })
})

describe('mentions', () => {
  it('matches an instrument inside its preparation and assessment forms', () => {
    expect(mentions('Подготовка доклада', 'Доклад')).toBe(true)
    expect(mentions('Заслушивание доклада', 'Доклад')).toBe(true)
    expect(mentions('Проверка контрольных работ', 'Контрольная работа')).toBe(true)
  })

  it('does not match a different instrument that shares a generic word', () => {
    expect(mentions('Лабораторная работа', 'Контрольная работа')).toBe(false)
    expect(mentions('Подготовка доклада', 'Реферат')).toBe(false)
  })

  // Found in production 2026-08-20: a real РПД's «Доклад, сообщение» instrument
  // (one genre, two interchangeable words for it — standard РПД convention)
  // was flagged missing from СРС/КСР even though «Подготовка доклада» and
  // «Заслушивание доклада» were right there, because the old all-tokens
  // matching required BOTH «доклад» and «сообщение» together in one phrase.
  it('matches a comma-joined synonym instrument via either alternative', () => {
    expect(mentions('Подготовка доклада', 'Доклад, сообщение')).toBe(true)
    expect(mentions('Заслушивание доклада', 'Доклад, сообщение')).toBe(true)
    expect(mentions('Проверка сообщения на занятии', 'Доклад, сообщение')).toBe(true)
    expect(mentions('Лабораторная работа', 'Доклад, сообщение')).toBe(false)
  })

  it('matches an explicit «X и/или Y» instrument via either branch', () => {
    expect(mentions('Подготовка к проекту', 'Доклад и/или Проект')).toBe(true)
    expect(mentions('Подготовка доклада', 'Доклад и/или Проект')).toBe(true)
    expect(mentions('Подготовка к тестированию', 'Доклад и/или Проект')).toBe(false)
  })
})

describe('parseAssessmentLinkage — §9 must survive truncation on a real-length РПД', () => {
  // Found in production 2026-08-20: a naive slice(0, 14000) from the start of
  // the document cut off §9 (page 11 of a 14-page РПД), so every instrument
  // came back "missing from п.9" — not a matching bug, §9's text was simply
  // never shown to the model. Reproduces the shape: §4's table near the top,
  // ~20000 chars of unrelated content sections in between, §9 near the end —
  // well past the old 14000-char boundary.
  it('includes §9 text in the prompt even when it sits past the old 14000-char cutoff', async () => {
    chatJSONMock.mockResolvedValueOnce({ instruments: [], srs_forms: [], ksr_forms: [], brs_items: [] })

    const filler = 'Лекционный материал по теме. '.repeat(1000)   // ~30000 chars
    const text = [
      '4. Структура и содержание дисциплины',
      'Раздел 1 | Доклад',
      filler,
      '9. Использование рейтинговой системы оценки знаний',
      'Доклад, сообщение | 3 | 18 | 30',
    ].join('\n')
    expect(text.length).toBeGreaterThan(14000)

    await parseAssessmentLinkage('t1', text)

    const userMessage = chatJSONMock.mock.calls[0][0][1].content as string
    expect(userMessage).toContain('Использование рейтинговой системы')
    expect(userMessage).toContain('Доклад, сообщение')
  })
})

// ─── ФОС «Перечень оценочных средств» ↔ п.9 (методист, 2026-08-25) ───────────
// Numbers taken from the КНИТУ «Макет ФОС 3++» worked example and from the
// real Иностранный язык РПД she tested with (three semesters, same instrument
// carrying different points in each).

const row = (name: string, semester: string | null, min: number | null, max: number | null): BrsScoreRow =>
  ({ name, semester, min_points: min, max_points: max })
const fosRow = (name: string, semester: string | null, min: number | null, max: number | null): FosScoreRow =>
  ({ name, semester, count: 1, min_points: min, max_points: max })

// One semester adding up to exactly 60/100, as the положение requires.
const RPD_SEM1: BrsScoreRow[] = [
  row('Деловая и/или ролевая игра', '1-й семестр', 8, 15),
  row('Проект', '1-й семестр', 10, 15),
  row('Тест', '1-й семестр', 24, 40),
  row('Доклад, сообщение', '1-й семестр', 18, 30),
]
const FOS_SEM1: FosScoreRow[] = RPD_SEM1.map((r) => fosRow(r.name, r.semester, r.min_points, r.max_points))

describe('checkFosScores', () => {
  it('passes when every instrument and both point columns agree', () => {
    const result = checkFosScores(RPD_SEM1, FOS_SEM1)
    expect(result.table_found).toBe(true)
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/совпадают с п\.9/)
  })

  it('distinguishes "no score table in the ФОС" from "table found and correct"', () => {
    const result = checkFosScores(RPD_SEM1, null)
    expect(result.table_found).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/не найдена таблица/)
  })

  it('flags a max that disagrees with п.9 — the case she reported', () => {
    const fos = FOS_SEM1.map((r) => r.name === 'Проект' ? { ...r, max_points: 20 } : r)
    const result = checkFosScores(RPD_SEM1, fos)
    const f = result.findings.find((x) => x.kind === 'max_mismatch')!
    expect(f.instrument).toBe('Проект')
    expect(f.rpd_max).toBe(15)
    expect(f.fos_max).toBe(20)
    expect(f.detail).toMatch(/максимальный балл в ФОС — 20/)
  })

  it('flags a min that disagrees with п.9', () => {
    const fos = FOS_SEM1.map((r) => r.name === 'Тест' ? { ...r, min_points: 20 } : r)
    const result = checkFosScores(RPD_SEM1, fos)
    expect(result.findings.some((f) => f.kind === 'min_mismatch' && f.instrument === 'Тест')).toBe(true)
  })

  it('flags an instrument п.9 declares but the ФОС omits', () => {
    const result = checkFosScores(RPD_SEM1, FOS_SEM1.filter((r) => r.name !== 'Доклад, сообщение'))
    const f = result.findings.find((x) => x.kind === 'missing_in_fos')!
    expect(f.instrument).toBe('Доклад, сообщение')
  })

  it('flags an instrument the ФОС budgets points for but п.9 never declared', () => {
    const fos = [...FOS_SEM1, fosRow('Реферат', '1-й семестр', 6, 10)]
    const result = checkFosScores(RPD_SEM1, fos)
    expect(result.findings.some((f) => f.kind === 'missing_in_rpd' && f.instrument === 'Реферат')).toBe(true)
  })

  it('flags a semester that does not total 60/100', () => {
    const fos = FOS_SEM1.map((r) => r.name === 'Тест' ? { ...r, min_points: 20, max_points: 35 } : r)
    const result = checkFosScores(
      RPD_SEM1.map((r) => r.name === 'Тест' ? { ...r, min_points: 20, max_points: 35 } : r), fos,
    )
    const f = result.findings.find((x) => x.kind === 'total_mismatch')!
    expect(f.fos_min).toBe(56)
    expect(f.fos_max).toBe(95)
    expect(f.detail).toMatch(/должна быть 60\/100/)
  })

  // The bug a naive implementation would have: summing across semesters gives
  // 180/300 and flags every correct multi-semester РПД.
  it('applies the 60/100 rule per semester, not across the whole discipline', () => {
    const rpd = [
      ...RPD_SEM1,
      ...RPD_SEM1.map((r) => ({ ...r, semester: '2-й семестр' })),
      ...RPD_SEM1.map((r) => ({ ...r, semester: '3-й семестр' })),
    ]
    const fos = rpd.map((r) => fosRow(r.name, r.semester, r.min_points, r.max_points))
    expect(checkFosScores(rpd, fos).findings).toEqual([])
  })

  it('does not match an instrument across a semester boundary', () => {
    // «Проект» exists in both semesters with DIFFERENT points — comparing the
    // 1-й семестр row against the 2-й семестр one would report a false mismatch.
    const rpd = [row('Проект', '1-й семестр', 10, 15), row('Проект', '3-й семестр', 18, 30)]
    const fos = [fosRow('Проект', '1-й семестр', 10, 15), fosRow('Проект', '3-й семестр', 18, 30)]
    expect(checkFosScores(rpd, fos).findings.filter((f) => f.kind !== 'total_mismatch')).toEqual([])
  })

  it('ignores «Итого» rows when matching instruments', () => {
    const rpd = [...RPD_SEM1, row('Итого:', '1-й семестр', 60, 100)]
    const fos = [...FOS_SEM1, fosRow('Итого:', '1-й семестр', 60, 100)]
    const result = checkFosScores(rpd, fos)
    // The Итого row must not be reported as an instrument, and must not be
    // double-counted into the semester sum.
    expect(result.findings).toEqual([])
  })
})

// The third arithmetic layer: §9 → перечень ФОС → «Критерии оценки».
// Numbers from the макет's own worked example — its «Критерии оценки
// лабораторных работ» table sums to 12/20, exactly its перечень row.
const crit = (o: Partial<FosCriteriaBlock> = {}): FosCriteriaBlock => ({
  instrument: 'Лабораторная работа',
  declared_min: 12, declared_max: 20,
  component_min: 12, component_max: 20,
  ...o,
})
const LAB_ROW: FosScoreRow[] = [
  { name: 'Лабораторная работа', semester: null, count: 4, min_points: 12, max_points: 20 },
  { name: 'Экзамен', semester: null, count: 1, min_points: 48, max_points: 80 },
]
const LAB_BRS: BrsScoreRow[] = [
  { name: 'Лабораторная работа', semester: null, min_points: 12, max_points: 20 },
  { name: 'Экзамен', semester: null, min_points: 48, max_points: 80 },
]

describe('checkFosScores — per-instrument criteria sums', () => {
  it('accepts a block whose parts add up to what it declares, matching the перечень', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit()])
    expect(result.findings.filter((f) => f.kind.startsWith('criteria_'))).toEqual([])
  })

  it('flags parts that do not add up to the declared maximum', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit({ component_max: 18 })])
    const f = result.findings.find((x) => x.kind === 'criteria_sum_mismatch')!
    expect(f.instrument).toBe('Лабораторная работа')
    expect(f.detail).toMatch(/заявлен максимум 20 баллов, а составляющие дают в сумме 18/)
  })

  it('flags parts that do not add up to the declared minimum', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit({ component_min: 10 })])
    expect(result.findings.some((f) => f.kind === 'criteria_sum_mismatch' && /минимум 12/.test(f.detail))).toBe(true)
  })

  it('flags a block whose declared total disagrees with its перечень row', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit({ declared_max: 25, component_max: 25 })])
    const f = result.findings.find((x) => x.kind === 'criteria_table_mismatch')!
    expect(f.detail).toMatch(/в критериях оценки максимум 25 баллов, а в перечне оценочных средств — 20/)
  })

  // An un-itemised block is not a sum of zero.
  it('says nothing when the block was never itemised', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit({ component_min: null, component_max: null })])
    expect(result.findings.filter((f) => f.kind.startsWith('criteria_'))).toEqual([])
  })

  it('says nothing when the block declares no total of its own', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit({ declared_min: null, declared_max: null })])
    expect(result.findings.filter((f) => f.kind.startsWith('criteria_'))).toEqual([])
  })

  it('ignores a criteria block for an instrument the перечень never lists', () => {
    const result = checkFosScores(LAB_BRS, LAB_ROW, [crit({ instrument: 'Коллоквиум', declared_max: 99, component_max: 99 })])
    expect(result.findings.filter((f) => f.kind === 'criteria_table_mismatch')).toEqual([])
  })

  // A multi-semester instrument has no single total to compare a once-written
  // criteria block against — checking it would be arbitrary.
  it('skips the перечень comparison when the instrument scores differently per semester', () => {
    const rows: FosScoreRow[] = [
      { name: 'Проект', semester: '1-й семестр', count: 1, min_points: 10, max_points: 15 },
      { name: 'Проект', semester: '3-й семестр', count: 1, min_points: 18, max_points: 30 },
    ]
    const brs: BrsScoreRow[] = rows.map((r) => ({
      name: r.name, semester: r.semester, min_points: r.min_points, max_points: r.max_points,
    }))
    const result = checkFosScores(brs, rows, [crit({ instrument: 'Проект', declared_min: 10, declared_max: 15, component_min: 10, component_max: 15 })])
    expect(result.findings.filter((f) => f.kind === 'criteria_table_mismatch')).toEqual([])
  })

  it('carries the criteria blocks through on the result', () => {
    expect(checkFosScores(LAB_BRS, LAB_ROW, [crit()]).criteria).toHaveLength(1)
  })
})
