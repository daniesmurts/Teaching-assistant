import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { checkFosStructure } from './fosStructure'
import type { BrsScoreRow } from '../../../shared/types'

// The positive case is КНИТУ's own «Макет ФОС 3++», flattened to text the same
// way services/documentExtractor.ts produces it. If the макет itself ever
// fails this check, the check is wrong — not the document.
const MACKET = readFileSync(join(__dirname, '__fixtures__', 'fosMacket.txt'), 'utf8')

const brs = (name: string): BrsScoreRow =>
  ({ name, semester: null, min_points: null, max_points: null })

describe('checkFosStructure — against the real макет', () => {
  it('finds every required section in the макет itself', () => {
    const result = checkFosStructure(MACKET)
    expect(result.checked).toBe(true)
    expect(result.findings.filter((f) => f.kind === 'missing_section')).toEqual([])
    expect(result.present).toHaveLength(6)
    expect(result.summary).toMatch(/все обязательные/)
  })

  it('finds per-instrument criteria for the instruments the макет lays out', () => {
    // These are the ones the макет gives a worked «Критерии оценки» block.
    const items = [
      brs('Лабораторная работа'), brs('Контрольная работа'),
      brs('Деловая и/или ролевая игра'), brs('Кейс-задача'),
    ]
    const result = checkFosStructure(MACKET, items)
    expect(result.findings.filter((f) => f.kind === 'missing_criteria')).toEqual([])
  })

  it('flags an instrument the РПД budgets points for but the ФОС never gives criteria', () => {
    const result = checkFosStructure(MACKET, [brs('Лабораторная работа'), brs('Коллоквиум по метрологии')])
    const missing = result.findings.filter((f) => f.kind === 'missing_criteria')
    expect(missing).toHaveLength(1)
    expect(missing[0].instrument).toBe('Коллоквиум по метрологии')
    expect(missing[0].detail).toMatch(/начисляются баллы/)
  })

  it('ignores «Итого» rows when deciding which instruments need criteria', () => {
    const result = checkFosStructure(MACKET, [brs('Лабораторная работа'), brs('Итого:')])
    expect(result.findings.filter((f) => f.kind === 'missing_criteria')).toEqual([])
  })
})

describe('checkFosStructure — missing blocks', () => {
  it('does not run at all when no ФОС was uploaded', () => {
    const result = checkFosStructure(null)
    expect(result.checked).toBe(false)
    expect(result.findings).toEqual([])
    expect(result.summary).toMatch(/не загружен/)
  })

  it('treats text under the noise floor as no document', () => {
    expect(checkFosStructure('см. приложение').checked).toBe(false)
  })

  it('names each missing section with a concrete fix', () => {
    const stripped = MACKET.replace(/Шкала оценивания/g, '').replace(/Краткая характеристика/g, '')
    const result = checkFosStructure(stripped)
    const keys = result.findings.map((f) => f.section)
    expect(keys).toContain('grading_scale')
    expect(keys).toContain('instrument_catalogue')
    const scale = result.findings.find((f) => f.section === 'grading_scale')!
    expect(scale.recommendation).toMatch(/цифровое выражение/i)
  })

  it('reports a document with none of the required blocks', () => {
    const result = checkFosStructure('Произвольный текст без единого раздела макета. '.repeat(10))
    expect(result.present).toEqual([])
    expect(result.findings).toHaveLength(6)
    expect(result.summary).toMatch(/Отклонения от макета/)
  })

  // The макет says so itself: «Пункт согласовано в ФОС включают только те
  // кафедры, которые разрабатывают ФОС для других кафедр». Requiring it would
  // fire on every ФОС written by the kafedra that teaches the discipline.
  it('never requires СОГЛАСОВАНО, which the макет makes conditional', () => {
    const withoutIt = MACKET.replace(/СОГЛАСОВАНО/g, '')
    const result = checkFosStructure(withoutIt)
    expect(result.findings.filter((f) => f.kind === 'missing_section')).toEqual([])
  })

  // Методист feedback 2026-08-25: a кафедра-meeting protocol number and the
  // УТВЕРЖДЕНО signature are stamped in by a downstream signing workflow,
  // after this check runs — never present in a ФОС at review time.
  it('never requires the заседание-кафедры protocol or the УТВЕРЖДЕНО гриф', () => {
    const withoutBoth = MACKET
      .replace(/[^\n]*заседании кафедры[^\n]*/gi, '')
      .replace(/[^\n]*протокол от[^\n]*/gi, '')
      .replace(/УТВЕРЖДЕНО/g, '')
    const result = checkFosStructure(withoutBoth)
    expect(result.findings.filter((f) => f.kind === 'missing_section')).toEqual([])
  })
})
