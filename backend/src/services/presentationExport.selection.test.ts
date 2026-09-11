import { describe, it, expect } from 'vitest'
import { generatePresentationPptx } from './presentationExport'
import { extractPptxSlides } from './pptxImport'
import { selectSlides } from '../lib/slideSelection'
import type { Presentation, Slide } from '../../../shared/types'

// The export end of «Скачать выбранные слайды»: the helper narrows the deck,
// the exporter is untouched. Read back through this repo's own importer
// rather than asserted on the helper's output, so the guarantee is about the
// file a teacher opens in PowerPoint, not about an intermediate object.

const slide = (title: string): Slide =>
  ({ type: 'bullets', title, notes: '', citations: [], body: { items: ['пункт'] } }) as unknown as Slide

const deck = (titles: string[]): Presentation => ({
  id: 'p1', teacher_id: 't1', topic: 'Кавитация в насосах',
  slides: [
    { type: 'title', title: 'Кавитация в насосах', notes: '', citations: [],
      body: { subtitle: 'Гидравлика', lecturer: 'Иванов И.И.' } } as unknown as Slide,
    ...titles.map(slide),
  ],
  sources: [], generated_content: '', created_at: '2026-09-11T00:00:00.000Z',
} as unknown as Presentation)

describe('exporting a selection', () => {
  it('writes only the chosen slides, in deck order', async () => {
    const full = deck(['Механизм', 'Последствия', 'Защита'])
    const pptx = await generatePresentationPptx(selectSlides(full, [1, 3]))
    const read = await extractPptxSlides(pptx)

    expect(read).toHaveLength(2)
    expect(read.map((s) => s.title)).toEqual(['Механизм', 'Защита'])
  })

  it('still writes the whole deck when nothing was selected', async () => {
    const full = deck(['Механизм', 'Последствия'])
    const read = await extractPptxSlides(await generatePresentationPptx(selectSlides(full, null)))
    expect(read).toHaveLength(3)
  })

  it('exports a single slide without the cover when the cover was not chosen', async () => {
    // Literal by design: what was ticked is what comes out. Quietly adding a
    // title slide nobody selected would be a different deck than the one the
    // checkboxes described.
    const read = await extractPptxSlides(
      await generatePresentationPptx(selectSlides(deck(['Механизм', 'Защита']), [2])))
    expect(read.map((s) => s.title)).toEqual(['Защита'])
  })
})
