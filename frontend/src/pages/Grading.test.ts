import { describe, it, expect } from 'vitest'
import { findHighlight } from './Grading'

describe('findHighlight — citation → text highlight mapping', () => {
  const text =
    'Студент пишет: цифровизация образования началась задолго до пандемии. ' +
    'Опираясь на собственно ИТ — наименее сложная часть задачи; основная работа лежит в плоскости методики.'

  it('returns empty match when no quote is given', () => {
    const r = findHighlight(text, null)
    expect(r.match).toBe('')
    expect(r.before).toBe(text)
  })

  it('returns empty match when the quote does not appear', () => {
    const r = findHighlight(text, 'этой фразы нет в работе')
    expect(r.match).toBe('')
    expect(r.before).toBe(text)
  })

  it('splits the text into before/match/after on a verbatim hit', () => {
    const quote = 'цифровизация образования'
    const r = findHighlight(text, quote)
    expect(r.match).toBe(quote)
    expect(r.before + r.match + r.after).toBe(text)
  })

  it('is case-insensitive', () => {
    const r = findHighlight(text, 'ЦИФРОВИЗАЦИЯ ОБРАЗОВАНИЯ')
    expect(r.match.toLowerCase()).toBe('цифровизация образования')
  })

  it('tolerates collapsed/expanded whitespace in the quote', () => {
    const r = findHighlight(text, 'цифровизация    образования')
    expect(r.match).toBe('цифровизация образования')
  })

  it('preserves original casing and spacing in the matched span', () => {
    const r = findHighlight(text, 'опираясь на собственно ит')
    // Match must equal the original substring, not the lowercased query
    expect(text.includes(r.match)).toBe(true)
    expect(r.match[0]).toBe('О')   // capital, as in the source
  })

  it('rejects very short quotes (less than 4 chars)', () => {
    const r = findHighlight(text, 'ит')
    expect(r.match).toBe('')
  })

  it('returns empty for empty text', () => {
    const r = findHighlight('', 'anything')
    expect(r.match).toBe('')
  })
})
