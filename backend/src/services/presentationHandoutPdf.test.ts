import { describe, it, expect } from 'vitest'
import { faceFor, generatePresentationHandoutPdf } from './presentationHandoutPdf'
import type { Presentation, Slide } from '../../../shared/types'

// The failure this file exists for: pdfkit draws a glyph the font lacks as a
// tofu box, silently. The vendored PT faces have no lowercase Greek, so a
// hydraulics formula printed as boxes and nobody would have found out until a
// student was holding the paper. DejaVu (assets/fonts/README.md) is the
// fallback; faceFor is the rule that reaches for it.

describe('faceFor', () => {
  it('reaches for DejaVu when the text carries Greek PT cannot draw', () => {
    expect(faceFor('sansB', 'P = ρ g Q H')).toBe('sansBX')
    expect(faceFor('serifR', 'КПД η растёт')).toBe('serifRX')
  })

  it('reaches for it on arrows and operators too', () => {
    expect(faceFor('sans', '∇p → 0')).toBe('sansX')
  })

  it('keeps the house face for ordinary Russian prose', () => {
    expect(faceFor('serifR', 'Плотность воды при 20 °С — 998 кг/м³')).toBe('serifR')
    expect(faceFor('sansB', 'Образование паровых пузырьков')).toBe('sansB')
  })

  it('does not swap on sub/superscripts, which PT draws and formulas are full of', () => {
    // Triggering on these would set every formula in the fallback face, for
    // nothing — latexToPlainText emits them constantly.
    expect(faceFor('sansB', 'NPSH = (p₁ - p₂)/2')).toBe('sansB')
    expect(faceFor('sansB', 'S = a²')).toBe('sansB')
  })

  it('maps each weight to its own counterpart, so the swap keeps the weight', () => {
    expect(faceFor('serif', 'Δ и ρ')).toBe('serifX')
    expect(faceFor('sans', 'ρ')).toBe('sansX')
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
