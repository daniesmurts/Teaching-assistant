import { describe, it, expect } from 'vitest'
import { parseSlideSelection, selectSlides, selectionSuffix } from './slideSelection'
import type { Presentation, Slide } from '../../../shared/types'

const slide = (title: string, citations: number[] = []): Slide =>
  ({ type: 'bullets', title, notes: '', citations, body: { items: ['x'] } }) as unknown as Slide

const deck = (n: number, citations: number[][] = []): Presentation => ({
  id: 'p1', teacher_id: 't1', topic: 'Кавитация',
  slides: Array.from({ length: n }, (_, i) => slide(`Слайд ${i + 1}`, citations[i] ?? [])),
  sources: [
    { idx: 1, file_name: 'Гидравлика.pdf' },
    { idx: 2, file_name: 'Насосы.pdf' },
    { idx: 3, file_name: 'Справочник.pdf' },
  ],
  generated_content: '', created_at: '2026-09-11T00:00:00.000Z',
} as unknown as Presentation)

describe('parseSlideSelection', () => {
  it('reads the teacher’s 1-based numbers as 0-based indices', () => {
    expect(parseSlideSelection('1,3,5', 10)).toEqual([0, 2, 4])
  })

  it('returns null for no selection — that means the whole deck, as before', () => {
    expect(parseSlideSelection(undefined, 10)).toBeNull()
    expect(parseSlideSelection('', 10)).toBeNull()
  })

  it('sorts into deck order rather than the order they were ticked', () => {
    // A selection is "which slides", not "in what sequence" — silently
    // reordering a lecture is worse than any error message.
    expect(parseSlideSelection('5,1,3', 10)).toEqual([0, 2, 4])
  })

  it('collapses a slide chosen twice', () => {
    expect(parseSlideSelection('3,3,3', 10)).toEqual([2])
  })

  it('refuses a slide the deck does not have, naming the deck’s size', () => {
    expect(() => parseSlideSelection('11', 10)).toThrow('в ней нет')
    expect(() => parseSlideSelection('0', 10)).toThrow()
  })

  it('refuses malformed input instead of guessing at it', () => {
    // Guessing what "3a" meant is how a teacher gets slides they never chose.
    for (const bad of ['3a', '3.5', '-3', 'abc', '1;2']) {
      expect(() => parseSlideSelection(bad, 10)).toThrow()
    }
  })

  it('refuses a selection that is nothing but separators', () => {
    expect(() => parseSlideSelection(',,,', 10)).toThrow('Не выбрано')
  })
})

describe('selectSlides', () => {
  it('keeps only the chosen slides, in deck order', () => {
    const subset = selectSlides(deck(5), [0, 2, 4])
    expect(subset.slides!.map((s) => s.title)).toEqual(['Слайд 1', 'Слайд 3', 'Слайд 5'])
  })

  it('returns the presentation itself when nothing was selected', () => {
    const full = deck(3)
    expect(selectSlides(full, null)).toBe(full)
  })

  it('does not mutate the original — the request still uses it afterwards', () => {
    const full = deck(5)
    selectSlides(full, [0])
    expect(full.slides).toHaveLength(5)
    expect(full.sources).toHaveLength(3)
  })

  it('narrows the source list to what the chosen slides actually cite', () => {
    // The раздатка prints this list: a three-slide handout carrying a
    // twelve-entry bibliography is not a smaller document, it is a wrong one.
    const subset = selectSlides(deck(3, [[1], [2], [3]]), [0, 2])
    expect(subset.sources!.map((s) => s.idx)).toEqual([1, 3])
  })

  it('keeps the original source numbers rather than compacting them', () => {
    // Slide bodies carry «[3]» markers as text; renumbering the list without
    // rewriting every string would point that marker at a different book.
    const subset = selectSlides(deck(3, [[3], [], []]), [0])
    expect(subset.sources).toEqual([{ idx: 3, file_name: 'Справочник.pdf' }])
  })
})

describe('selectionSuffix', () => {
  it('adds nothing when the whole deck goes', () => {
    expect(selectionSuffix(null, 10)).toBe('')
    expect(selectionSuffix([0, 1, 2], 3)).toBe('')
  })

  it('names a contiguous run by its range', () => {
    expect(selectionSuffix([2, 3, 4], 10)).toBe(' (слайды 3–5)')
  })

  it('counts a scattered selection', () => {
    expect(selectionSuffix([0, 4, 8], 10)).toBe(' (3 слайда)')
  })

  it('names a single slide', () => {
    expect(selectionSuffix([6], 10)).toBe(' (слайд 7)')
  })

  it('gets Russian plurals right — three forms, not two', () => {
    const of = (n: number) => selectionSuffix(Array.from({ length: n }, (_, i) => i * 2), 100)
    expect(of(2)).toContain('2 слайда')
    expect(of(5)).toContain('5 слайдов')
    expect(of(11)).toContain('11 слайдов')   // not "11 слайд"
    expect(of(22)).toContain('22 слайда')
  })
})
