import { describe, it, expect } from 'vitest'
import { annotateWithPageMarkers, normaliseCriteriaScores } from './grading'
import type { CriterionScore } from '../../../shared/types'

describe('annotateWithPageMarkers', () => {
  it('returns text untouched with pageCount=1 when no form-feeds', () => {
    const r = annotateWithPageMarkers('Just a single page of text.')
    expect(r.text).toBe('Just a single page of text.')
    expect(r.pageCount).toBe(1)
  })

  it('counts pages by splitting on \\f', () => {
    const r = annotateWithPageMarkers('one\ftwo\fthree')
    expect(r.pageCount).toBe(3)
  })

  it('leaves page 1 implicit but prefixes pages 2+ with [стр. N]', () => {
    const r = annotateWithPageMarkers('one\ftwo\fthree')
    expect(r.text).not.toContain('[стр. 1]')
    expect(r.text).toContain('[стр. 2]')
    expect(r.text).toContain('[стр. 3]')
  })

  it('preserves the original content alongside the markers', () => {
    const r = annotateWithPageMarkers('first\fsecond')
    expect(r.text.includes('first')).toBe(true)
    expect(r.text.includes('second')).toBe(true)
  })
})

const submission =
  'Студент пишет: цифровизация образования началась задолго до пандемии. ' +
  'Опираясь на собственно ИТ — наименее сложная часть задачи; основная работа лежит в плоскости методики и взаимодействия. ' +
  'Дальнейшие выводы можно проследить по тексту работы.'

function score(over: Partial<CriterionScore> = {}): CriterionScore {
  return {
    name: 'Аргументация',
    score: 80,
    feedback: 'Хорошо',
    quote: null,
    page: null,
    ...over,
  } as CriterionScore
}

describe('normaliseCriteriaScores', () => {
  it('clamps numeric score to 0–100', () => {
    expect(normaliseCriteriaScores([score({ score: 150 })], submission, 1)[0].score).toBe(100)
    expect(normaliseCriteriaScores([score({ score: -10 })], submission, 1)[0].score).toBe(0)
  })

  it('keeps a verbatim quote that exists in the submission', () => {
    const quote = 'собственно ИТ — наименее сложная часть задачи'
    const out = normaliseCriteriaScores([score({ quote })], submission, 1)
    expect(out[0].quote).toBe(quote)
  })

  it('tolerates whitespace and case differences when matching the quote', () => {
    const quote = 'СОБСТВЕННО   ИТ — НАИМЕНЕЕ   СЛОЖНАЯ ЧАСТЬ ЗАДАЧИ'
    const out = normaliseCriteriaScores([score({ quote })], submission, 1)
    // Survives because the haystack is also normalized
    expect(out[0].quote).toBe(quote)
  })

  it('drops quotes that do not appear in the source (hallucination guard)', () => {
    const out = normaliseCriteriaScores(
      [score({ quote: 'этого предложения в работе нет' })],
      submission,
      1,
    )
    expect(out[0].quote).toBeNull()
  })

  it('drops quotes that are too short to be meaningful', () => {
    const out = normaliseCriteriaScores([score({ quote: 'три' })], submission, 1)
    expect(out[0].quote).toBeNull()
  })

  it('caps very long quotes to 200 chars', () => {
    const longQuote = 'a'.repeat(300)
    const haystack  = 'a'.repeat(400)
    const out = normaliseCriteriaScores([score({ quote: longQuote })], haystack, 1)
    expect(out[0].quote?.length).toBe(200)
  })

  it('accepts a page within the document range', () => {
    const out = normaliseCriteriaScores([score({ page: 2 })], submission, 5)
    expect(out[0].page).toBe(2)
  })

  it('rejects a page outside the document range', () => {
    expect(normaliseCriteriaScores([score({ page: 10 })], submission, 3)[0].page).toBeNull()
    expect(normaliseCriteriaScores([score({ page: 0 })],  submission, 3)[0].page).toBeNull()
    expect(normaliseCriteriaScores([score({ page: -1 })], submission, 3)[0].page).toBeNull()
  })

  it('rounds non-integer pages', () => {
    const out = normaliseCriteriaScores([score({ page: 2.7 as unknown as number })], submission, 5)
    expect(out[0].page).toBe(3)
  })

  it('trims and preserves name + feedback strings', () => {
    const out = normaliseCriteriaScores(
      [score({ name: '  Структура  ', feedback: '  ok  ' })],
      submission,
      1,
    )
    expect(out[0].name).toBe('Структура')
    expect(out[0].feedback).toBe('ok')
  })

  it('emits null quote/page when fields are absent', () => {
    const minimal = { name: 'X', score: 50, feedback: 'y' } as unknown as CriterionScore
    const out = normaliseCriteriaScores([minimal], submission, 1)
    expect(out[0].quote).toBeNull()
    expect(out[0].page).toBeNull()
  })
})
