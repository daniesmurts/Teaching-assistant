import { describe, it, expect, vi } from 'vitest'
import { checkAssessmentLinkage, mentions, parseAssessmentLinkage } from './assessmentLinkage'
import type { ParsedAssessmentLinkage } from '../../../shared/types'

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
    brs_items:   [{ name: 'Доклад', points: 10 }],
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
    const result = checkAssessmentLinkage(parsed({ brs_items: [{ name: 'Доклад', points: null }] }))
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
      brs_items:   [{ name: 'Экзамен', points: 40 }],
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
      brs_items: [{ name: 'Экзамен', points: 40 }],
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
