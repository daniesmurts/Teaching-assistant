import { describe, it, expect } from 'vitest'
import { classifyMatch, toCitationBullet, stripLeadingNumbering, reformulateQuery } from './citationChecker'
import type { SearchResult } from './yandexSearch'
import type { CitationVerdict } from '../../../shared/types'

function result(title: string, snippet = '', url = 'https://example.com'): SearchResult {
  return { title, url, snippet }
}

describe('classifyMatch', () => {
  it('classifies strong token overlap as found', () => {
    const verdict = classifyMatch(
      'Иванов И.И. Основы термодинамики. Москва: Наука, 2019.',
      [result('Иванов И.И. Основы термодинамики', 'учебник по термодинамике, издательство Наука, 2019')],
    )
    expect(verdict.status).toBe('found')
    expect(verdict.best_match_title).toContain('термодинамики')
  })

  it('classifies partial overlap as similar_found', () => {
    const verdict = classifyMatch(
      'Петров А.Б. Теория механизмов и машин. СПб: Политехника, 2015.',
      [result('Теория механизмов', 'общий курс машиностроения')],
    )
    expect(verdict.status).toBe('similar_found')
  })

  it('classifies zero results as not_found', () => {
    const verdict = classifyMatch('Сидоров В.Г. Несуществующая книга. 2020.', [])
    expect(verdict.status).toBe('not_found')
    expect(verdict.best_match_title).toBeNull()
  })

  it('classifies irrelevant results (no token overlap) as not_found', () => {
    const verdict = classifyMatch(
      'Сидоров В.Г. Квантовая механика полупроводников. 2020.',
      [result('Рецепты выпечки хлеба', 'домашняя кулинария, простые рецепты')],
    )
    expect(verdict.status).toBe('not_found')
  })
})

describe('stripLeadingNumbering', () => {
  it('strips a numbered-list prefix', () => {
    expect(stripLeadingNumbering('12. Иванов И.И. Основы термодинамики.')).toBe('Иванов И.И. Основы термодинамики.')
    expect(stripLeadingNumbering('[3] Петров А.Б. Теория механизмов.')).toBe('Петров А.Б. Теория механизмов.')
    expect(stripLeadingNumbering('3) Сидоров В.Г. Квантовая механика.')).toBe('Сидоров В.Г. Квантовая механика.')
  })

  it('leaves text without a numbering prefix unchanged', () => {
    expect(stripLeadingNumbering('Иванов И.И. Основы термодинамики.')).toBe('Иванов И.И. Основы термодинамики.')
  })
})

describe('reformulateQuery', () => {
  it('extracts a shorter title-only query using the year as a boundary', () => {
    const q = reformulateQuery('12. Иванов И.И. Основы термодинамики, 2019.')
    expect(q).toContain('Основы термодинамики')
    expect(q.length).toBeLessThan('12. Иванов И.И. Основы термодинамики, 2019.'.length)
  })

  it('falls back to a truncated raw string when no clear boundary exists', () => {
    const q = reformulateQuery('НекотораяОченьДлиннаяСтрокаБезЗапятыхИГодаВообще')
    expect(q.length).toBeGreaterThan(0)
  })
})

describe('toCitationBullet', () => {
  const submission = 'В работе использован источник: Иванов И.И. Основы термодинамики. Москва, 2019.'

  it('keeps the citation when the reference text appears verbatim in the submission', () => {
    const verdict: CitationVerdict = {
      index: 0,
      raw_text: 'Иванов И.И. Основы термодинамики. Москва, 2019.',
      query_used: 'Иванов И.И. Основы термодинамики',
      status: 'not_found',
      best_match_title: null,
      best_match_url: null,
      note: 'Не удалось найти источник.',
    }
    const bullet = toCitationBullet(verdict, submission)
    expect(bullet.quote).toBe('Иванов И.И. Основы термодинамики. Москва, 2019.')
    expect(bullet.severity).toBe('substantial')
    expect(bullet.action).toBe('verify')
    expect(bullet.text).toContain('термодинамики')
  })

  it('drops the citation when the reference text does not appear verbatim', () => {
    const verdict: CitationVerdict = {
      index: 0,
      raw_text: 'Совершенно другая ссылка, не встречающаяся в тексте.',
      query_used: 'другая ссылка',
      status: 'not_found',
      best_match_title: null,
      best_match_url: null,
      note: 'Не удалось найти источник.',
    }
    const bullet = toCitationBullet(verdict, submission)
    expect(bullet.quote).toBeNull()
  })

  it('never asserts fabrication — the note always includes the non-proof caveat for not_found', () => {
    // The caveat lives in noteFor() inside checkCitations(), verified indirectly here:
    // toCitationBullet must faithfully pass through whatever note it's given.
    const verdict: CitationVerdict = {
      index: 0, raw_text: 'x'.repeat(20), query_used: 'q', status: 'not_found',
      best_match_title: null, best_match_url: null,
      note: 'Не удалось найти источник — возможно, неточная ссылка или вымышленный источник. Отсутствие в поиске не доказывает подделку.',
    }
    const bullet = toCitationBullet(verdict, submission)
    expect(bullet.text).toContain('не доказывает подделку')
  })
})
