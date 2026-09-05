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
// A real 2×1 PNG, so the aspect-ratio path is exercised rather than a square.
const LOGO_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAADwdn+XAAAAD0lEQVR42mP8z8BQz0AEAAAsAgQAKz8vAAAAAABJRU5ErkJggg=='
const LOGO = { dataUri: `data:image/png;base64,${LOGO_B64}`, buffer: Buffer.from(LOGO_B64, 'base64') }

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
      accentColor: '#1A4D8F', institutionName: 'КНИТУ', logo: LOGO,
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

// ─── Title slide ────────────────────────────────────────────────────────────

describe('title slide', () => {
  it('is light, not the dark slab it used to be', async () => {
    // Teachers disliked the black field, and a title slide is the one projected
    // longest — often in a lit room, where dark is the projector's worst case.
    const zip = await JSZip.loadAsync(await generatePresentationPptx(deck, null))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('FFFFFF')
    expect(xml).not.toContain('1A1A1A"/></a:solidFill></p:bg')   // no ink background
  })

  it('draws the logo at its own aspect ratio, not the frame\'s', async () => {
    // The reported bug: a wide logo came out squashed because pptxgenjs draws
    // to the frame when handed w/h plus `sizing: contain`. A 2:1 image in a
    // 2.6×0.85in box must land 1.7×0.85, not 2.6×0.85.
    const zip = await JSZip.loadAsync(await generatePresentationPptx(deck, { logo: LOGO }))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    // Scoped to <p:pic>: the first <a:ext> in a slide is the shape group's own
    // extent (0×0), not the image's.
    const pic = xml.slice(xml.indexOf('<p:pic>'), xml.indexOf('</p:pic>'))
    const ext = pic.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/)
    expect(ext).toBeTruthy()
    const [cx, cy] = [Number(ext![1]), Number(ext![2])]
    expect(cx / cy).toBeCloseTo(2, 1)          // the image's own 2:1, preserved
    expect(cx / cy).not.toBeCloseTo(2.6 / 0.85, 1)   // ≠ the frame's 3.06:1
  })

  it('keeps the brand colour to graphics, never to text on this slide', async () => {
    // An institution may pick a pale accent; pale-on-white text would be
    // unreadable, while a rule is judged at 3:1 and carries no meaning.
    const zip = await JSZip.loadAsync(await generatePresentationPptx(deck, { accentColor: '#F4C55A' }))
    const xml = await zip.file('ppt/slides/slide1.xml')!.async('string')
    expect(xml).toContain('F4C55A')                       // present as shapes
    expect(xml).not.toMatch(/<a:solidFill><a:srgbClr val="F4C55A"\/><\/a:solidFill><\/a:rPr>/)  // not as run colour
  })
})
