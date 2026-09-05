import { describe, it, expect } from 'vitest'
import { extractPptxSlides, toTypedSlides, importPptx } from './pptxImport'
import { generatePresentationPptx } from './presentationExport'
import type { Presentation, Slide } from '../../../shared/types'

// Round-trip against real OOXML rather than a hand-written fixture: the deck is
// produced by this app's own exporter (pptxgenjs), so the test reads the same
// XML PowerPoint itself writes. A fixture would only prove the parser matches
// my idea of the format.

const deck = (slides: Slide[]): Presentation => ({
  id: 'p1', teacher_id: 't1', course_id: null, course_name: null, lecture_number: 1,
  lecture_topic_id: null, approved_at: null, topic: 'Кавитация в насосах',
  duration_minutes: 90, audience_level: null, learning_goals: null, style: null,
  slide_count_target: slides.length, slides, generated_content: '', sources: [],
  created_at: '2026-09-05T00:00:00.000Z',
} as unknown as Presentation)

const SOURCE: Slide[] = [
  { type: 'title', title: 'Кавитация в насосах', notes: '', citations: [],
    body: { subtitle: 'Гидравлика', lecturer: 'Иванов И.И.' } },
  { type: 'bullets', title: 'Что происходит', notes: 'Здесь я объясняю механизм и привожу пример на 3 атм.', citations: [],
    body: { items: ['падение давления ниже давления насыщения', 'образование пузырьков', 'схлопывание у колеса'] } },
  { type: 'concept', title: 'Определение', notes: 'Даю определение и уточняю границы.', citations: [],
    body: { definition: 'Кавитация — образование паровых пузырьков в потоке', supporting: ['зависит от температуры'] } },
] as unknown as Slide[]

describe('pptx round-trip', () => {
  it('reads back the slides this app exported, in order', async () => {
    const pptx = await generatePresentationPptx(deck(SOURCE))
    const imported = await extractPptxSlides(pptx)

    expect(imported.length).toBeGreaterThanOrEqual(3)
    expect(imported[0].title).toContain('Кавитация в насосах')
    expect(imported[1].title).toBe('Что происходит')
    expect(imported[2].title).toBe('Определение')
  })

  it('recovers the bullet text, not just the titles', async () => {
    const imported = await extractPptxSlides(await generatePresentationPptx(deck(SOURCE)))
    const joined = imported[1].bullets.join(' | ')
    expect(joined).toContain('образование пузырьков')
    expect(joined).toContain('схлопывание у колеса')
  })

  it('recovers speaker notes and attaches them to the right slide', async () => {
    // The notes↔slide mapping goes through each slide's rels, not filename
    // numbering — a deck where only some slides have notes numbers them
    // independently, so slide 3 can own notesSlide1.
    const imported = await extractPptxSlides(await generatePresentationPptx(deck(SOURCE)))
    expect(imported[1].notes).toContain('пример на 3 атм')
    expect(imported[2].notes).toContain('уточняю границы')
    expect(imported[0].notes).not.toContain('пример на 3 атм')
  })

  it('produces slides the rest of the app can render', async () => {
    const { slides, sourceSlideCount } = await importPptx(await generatePresentationPptx(deck(SOURCE)))
    expect(sourceSlideCount).toBe(slides.length)
    expect(slides[0].type).toBe('title')
    // Everything else stays `bullets` on purpose — the source carries no type
    // information, and a mis-detected `formula` would render a sentence as an
    // equation. «Переписать» upgrades any slide in one click.
    expect(slides.slice(1).every((s) => s.type === 'bullets')).toBe(true)
    expect(slides.every((s) => Array.isArray(s.citations))).toBe(true)
  })

  it('returns nothing for a file that is not a pptx, without throwing', async () => {
    // Import must fail as "we couldn't read it", never as a 500.
    expect(await importPptx(Buffer.from('это не презентация'))).toEqual({ slides: [], sourceSlideCount: 0 })
  })
})

describe('toTypedSlides', () => {
  it('only treats the first slide as a title when it looks like one', () => {
    const dense = toTypedSlides([{ title: 'Повестка', bullets: ['раз', 'два', 'три', 'четыре'], notes: '' }])
    expect(dense[0].type).toBe('bullets')   // four bullets is an agenda, not a cover
  })

  it('carries the subtitle and lecturer off a cover slide', () => {
    const [slide] = toTypedSlides([{ title: 'Лекция 1', bullets: ['Гидравлика', 'Иванов И.И.'], notes: '' }])
    expect(slide).toMatchObject({ type: 'title', body: { subtitle: 'Гидравлика', lecturer: 'Иванов И.И.' } })
  })
})
