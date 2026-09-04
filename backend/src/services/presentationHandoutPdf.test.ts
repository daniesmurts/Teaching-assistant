import { describe, it, expect } from 'vitest'
import { printable, generatePresentationHandoutPdf } from './presentationHandoutPdf'
import type { Presentation, Slide } from '../../../shared/types'

// The failure this file exists for: pdfkit draws a glyph the font lacks as a
// tofu box, silently. The vendored PT Sans/PT Serif have no lowercase Greek,
// so a hydraulics formula would print as boxes and nobody would find out until
// a student was holding the paper.

describe('printable', () => {
  it('substitutes Greek the vendored fonts cannot draw', () => {
    expect(printable('ρ g Q H')).toBe('rho g Q H')
    expect(printable('η = P₂/P₁')).toBe('eta = P₂/P₁')
    expect(printable('Σ и Δ')).toBe('Sigma и Δ')   // Δ is present in the fonts, Σ is not
  })

  it('leaves Cyrillic, Latin and the glyphs the fonts do have alone', () => {
    expect(printable('Плотность μ и π при 20 °С — 998 кг/м³'))
      .toBe('Плотность μ и π при 20 °С — 998 кг/м³')
  })

  it('handles the two non-Greek gaps', () => {
    expect(printable('∇p → 0')).toBe('nablap -> 0')
  })
})

describe('generatePresentationHandoutPdf', () => {
  const slides = [
    { type: 'title', title: 'Кавитация', notes: '', citations: [], body: { subtitle: 'Гидравлика', lecturer: 'И.И.' } },
    { type: 'concept', title: 'Понятие', notes: 'Речь про $\\rho$ и кавитацию [1].', citations: [1],
      body: { definition: 'Пузырьки', supporting: ['падение давления'] } },
    { type: 'formula', title: 'Формула', notes: '', citations: [],
      body: { formulas: [{ latex: 'P = \\rho g Q H', caption: 'Мощность' }], explanation: null } },
  ] as unknown as Slide[]

  const deck = {
    id: 'p1', topic: 'Кавитация', course_name: 'Гидравлика', lecture_number: 4, slides,
    sources: [{ idx: 1, document_id: 'd', file_name: 'Учебник.pdf', page_start: 12, page_end: 14, excerpt: '', chunk_type: null }],
  } as unknown as Presentation

  it('produces a real PDF', async () => {
    const pdf = await generatePresentationHandoutPdf(deck, { includeNotes: true, lecturer: 'Иванов И.И.' })
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-')
    expect(pdf.length).toBeGreaterThan(1000)
  })

  it('drops the speaker notes when the teacher wants a skeleton to write on', async () => {
    const withNotes = await generatePresentationHandoutPdf(deck, { includeNotes: true })
    const without   = await generatePresentationHandoutPdf(deck, { includeNotes: false })
    expect(without.length).toBeLessThan(withNotes.length)
  })

  it('renders a deck with no slides rather than throwing', async () => {
    // The route rejects this case, but a PDF generator that throws on an empty
    // array is a 500 waiting for the next caller.
    const empty = { ...deck, slides: [], sources: [] } as unknown as Presentation
    expect((await generatePresentationHandoutPdf(empty)).subarray(0, 5).toString()).toBe('%PDF-')
  })
})
