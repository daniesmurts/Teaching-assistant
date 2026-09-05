import { describe, it, expect } from 'vitest'
import { findOverfullSlides, slideBodyText } from '../../../shared/slideFit'
import type { Slide } from '../../../shared/types'

const bullets = (items: string[], title = 'Слайд'): Slide =>
  ({ type: 'bullets', title, notes: 'длинные заметки '.repeat(50), citations: [], body: { items } } as unknown as Slide)

describe('findOverfullSlides', () => {
  it('passes a normal slide', () => {
    expect(findOverfullSlides([bullets(['раз', 'два', 'три'])])).toEqual([])
  })

  it('flags a slide with too many bullets', () => {
    const [fit] = findOverfullSlides([bullets(Array.from({ length: 11 }, (_, i) => `тезис ${i}`))])
    expect(fit.index).toBe(0)
    expect(fit.reason).toContain('строк')
  })

  it('flags a slide whose few lines are enormous', () => {
    const [fit] = findOverfullSlides([bullets(['и'.repeat(400), 'ещё '.repeat(80)])])
    expect(fit.reason).toContain('символов')
  })

  it('ignores speaker notes — they are never drawn on the slide', () => {
    // The fixture's notes are ~800 characters; the slide itself is tiny.
    expect(findOverfullSlides([bullets(['коротко'])])).toEqual([])
  })

  it('gives a diagram slide a smaller budget, since the image takes the room', () => {
    const diagram = {
      type: 'diagram', title: 'Схема', notes: '', citations: [],
      body: { image_query: 'q', caption: 'подпись', points: Array.from({ length: 7 }, (_, i) => `пункт ${i}`), image: null },
    } as unknown as Slide
    expect(findOverfullSlides([diagram])).toHaveLength(1)
  })

  it('reports every over-full slide with its index', () => {
    const deck = [bullets(['ок']), bullets(Array.from({ length: 12 }, () => 'много')), bullets(['ок'])]
    expect(findOverfullSlides(deck).map((f) => f.index)).toEqual([1])
  })
})

describe('slideBodyText', () => {
  it('reads the visible text of each slide type', () => {
    const comparison = {
      type: 'comparison', title: 'Т', notes: '', citations: [],
      body: { columns: [{ header: 'A', items: ['a1'] }, { header: 'B', items: ['b1'] }] },
    } as unknown as Slide
    expect(slideBodyText(comparison)).toEqual(['A', 'a1', 'B', 'b1'])
  })
})
