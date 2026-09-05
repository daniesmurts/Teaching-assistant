import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { generatePresentationPptx } from './presentationExport'
import type { Presentation, Slide } from '../../../shared/types'

// Branding lives in module state (an export is one sequential pass), which is
// efficient and exactly the shape that leaks between requests if the fallback
// is wrong. These tests read the produced package rather than trusting the
// call: a corrupt colour in a .pptx surfaces as "PowerPoint can't open this",
// with nothing in the logs.

const SLIDES: Slide[] = [
  { type: 'title', title: 'Кавитация', notes: '', citations: [], body: { subtitle: 'Гидравлика', lecturer: 'И.И.' } },
  { type: 'bullets', title: 'Тезисы', notes: '', citations: [], body: { items: ['раз', 'два'] } },
] as unknown as Slide[]

const deck = { id: 'p1', topic: 'Кавитация', slides: SLIDES, sources: [] } as unknown as Presentation

// A 1×1 transparent PNG — enough to prove the image lands in the package.
const LOGO = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

async function slideXml(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer)
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
  const parts = await Promise.all(names.sort().map((n) => zip.file(n)!.async('string')))
  return parts.join('')
}

describe('deck branding', () => {
  it('paints the institution accent colour into the deck', async () => {
    const xml = await slideXml(await generatePresentationPptx(deck, { accentColor: '#1A4D8F' }))
    expect(xml).toContain('1A4D8F')
    expect(xml).not.toContain('C8860A')   // the platform amber is gone
  })

  it('keeps the platform look when the institution set no colour', async () => {
    const xml = await slideXml(await generatePresentationPptx(deck, { accentColor: null }))
    expect(xml).toContain('C8860A')
  })

  it('does NOT leak one institution\'s brand into the next export', async () => {
    // The failure this file exists for: module state + a fallback of `accent`
    // rather than the platform default would make every deck after a branded
    // one silently inherit that university's colour.
    await generatePresentationPptx(deck, { accentColor: '#1A4D8F' })
    const plain = await slideXml(await generatePresentationPptx(deck, null))
    expect(plain).not.toContain('1A4D8F')
    expect(plain).toContain('C8860A')
  })

  it('ignores a malformed colour rather than emitting a corrupt package', async () => {
    const xml = await slideXml(await generatePresentationPptx(deck, { accentColor: 'rgb(1,2,3)' as string }))
    expect(xml).toContain('C8860A')
  })

  it('puts the logo and the institution name on the титульный лист', async () => {
    const buffer = await generatePresentationPptx(deck, {
      accentColor: '#1A4D8F', institutionName: 'КНИТУ', logo: { dataUri: LOGO },
    })
    const zip = await JSZip.loadAsync(buffer)
    const media = Object.keys(zip.files).filter((n) => n.startsWith('ppt/media/'))
    expect(media.length).toBeGreaterThan(0)          // the logo was embedded
    expect(await slideXml(buffer)).toContain('КНИТУ')
  })

  it('still exports for a teacher with no institution at all', async () => {
    const buffer = await generatePresentationPptx(deck, null)
    expect(buffer.subarray(0, 2).toString()).toBe('PK')
  })
})
