import { describe, it, expect, vi, beforeEach } from 'vitest'

const { loadSlideImage } = vi.hoisted(() => ({ loadSlideImage: vi.fn() }))
vi.mock('./slideImageSource', () => ({ loadSlideImage }))

import { loadHandoutPictures, generatePresentationHandoutPdf } from './presentationHandoutPdf'
import type { Presentation, Slide, SlideImage } from '../../../shared/types'

// Header-only PNG: imageSize reads the IHDR at a fixed offset, which is what
// decides both the fit and whether pdfkit can embed the file at all.
const png = (w: number, h: number): Buffer => {
  const buf = Buffer.alloc(33)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
  buf.writeUInt32BE(13, 8)
  buf.write('IHDR', 12, 'latin1')
  buf.writeUInt32BE(w, 16)
  buf.writeUInt32BE(h, 20)
  return buf
}

const image = (url: string, host: string | null = null): SlideImage => ({
  url, source_url: url, thumbnail: url, width: null, height: null,
  query: 'схема', source_host: host,
})

const slideWith = (img: SlideImage | null): Slide =>
  ({ type: 'bullets', title: 'Рис. 1', notes: '', citations: [], body: { items: ['обозначения'] },
     ...(img ? { image: img } : {}) }) as unknown as Slide

const COLUMN = 483   // A4 less two 56pt margins

beforeEach(() => vi.clearAllMocks())

describe('loadHandoutPictures', () => {
  it('fits a wide drawing to the text column without upscaling a small one', async () => {
    loadSlideImage
      .mockResolvedValueOnce({ buffer: png(2000, 1000), mime: 'image/png' })
      .mockResolvedValueOnce({ buffer: png(200, 150), mime: 'image/png' })

    const pictures = await loadHandoutPictures(
      [slideWith(image('/api/presentations/media/a/image')), slideWith(image('/api/presentations/media/b/image'))],
      COLUMN)

    // 2000×1000 px is 1500×750 pt, so the 240 pt height cap bites before the
    // column width does — 480 pt wide, not the full 483.
    expect(pictures.get(0)!.w).toBeLessThanOrEqual(COLUMN)
    expect(pictures.get(0)!.h).toBeCloseTo(240, 0)
    // Left at its own resolution: a 200px schematic blown up to the column
    // width prints worse than the same drawing left small.
    expect(pictures.get(1)!.w).toBeCloseTo(150, 0)
  })

  it('caps a tall drawing by height so one figure cannot eat a page', async () => {
    loadSlideImage.mockResolvedValue({ buffer: png(400, 1600), mime: 'image/png' })
    const pictures = await loadHandoutPictures([slideWith(image('/api/presentations/media/a/image'))], COLUMN)
    expect(pictures.get(0)!.h).toBeLessThanOrEqual(240)
    // Aspect kept — 400×1600 is 1:4 whatever it is scaled to.
    expect(pictures.get(0)!.h / pictures.get(0)!.w).toBeCloseTo(4, 1)
  })

  it('skips a format pdfkit would throw on, rather than losing the handout', async () => {
    // A WebP from image search reaches doc.image() as an unsupported format,
    // and the throw takes the whole document with it.
    loadSlideImage.mockResolvedValue({ buffer: Buffer.from('RIFF....WEBPVP8 '), mime: 'image/webp' })
    expect(await loadHandoutPictures([slideWith(image('https://example.org/x.webp'))], COLUMN)).toEqual(new Map())
  })

  it('skips an image whose bytes cannot be loaded at all', async () => {
    loadSlideImage.mockResolvedValue(null)
    expect(await loadHandoutPictures([slideWith(image('/api/presentations/media/gone/image'))], COLUMN)).toEqual(new Map())
  })

  it('credits a web image and does not credit the teacher’s own picture', async () => {
    loadSlideImage.mockResolvedValue({ buffer: png(800, 600), mime: 'image/png' })

    const web = await loadHandoutPictures([slideWith(image('https://ru.wikipedia.org/x.png', 'wikipedia.org'))], COLUMN)
    expect(web.get(0)!.credit).toBe('wikipedia.org')

    const own = await loadHandoutPictures(
      [slideWith(image('/api/presentations/media/a/image', 'Из загруженной презентации'))], COLUMN)
    expect(own.get(0)!.credit).toBeNull()
  })

  it('reads a diagram slide’s image from where that type keeps it', async () => {
    // DiagramSlide has its own body.image; every other type uses the top-level
    // field (shared/types.ts's SlideBase).
    loadSlideImage.mockResolvedValue({ buffer: png(800, 600), mime: 'image/png' })
    const diagram = { type: 'diagram', title: 'Схема', notes: '', citations: [],
      body: { caption: 'схема', points: [], image: image('/api/presentations/media/a/image') } } as unknown as Slide
    expect((await loadHandoutPictures([diagram], COLUMN)).size).toBe(1)
  })

  it('leaves a slide with no picture out of the map entirely', async () => {
    expect(await loadHandoutPictures([slideWith(null)], COLUMN)).toEqual(new Map())
    expect(loadSlideImage).not.toHaveBeenCalled()
  })
})

describe('the handout itself', () => {
  const deck = (slides: Slide[]): Presentation => ({
    id: 'p1', teacher_id: 't1', topic: 'ВСС на базе ЖКВН', slides,
    generated_content: '', sources: [], created_at: '2026-09-08T00:00:00.000Z',
    course_name: null, lecture_number: 1,
  } as unknown as Presentation)

  it('embeds the picture in the PDF', async () => {
    // Real PNG bytes — pdfkit decodes the file, so a header-only fixture that
    // satisfies imageSize would not survive the embed.
    loadSlideImage.mockResolvedValue({ buffer: REAL_PNG, mime: 'image/png' })

    const pdf = await generatePresentationHandoutPdf(deck([slideWith(image('/api/presentations/media/a/image'))]))
    expect((pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBeGreaterThan(0)
  })

  it('still produces a handout when every picture fails to load', async () => {
    loadSlideImage.mockResolvedValue(null)
    const pdf = await generatePresentationHandoutPdf(deck([slideWith(image('/api/presentations/media/a/image'))]))
    expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-')
    expect((pdf.toString('latin1').match(/\/Subtype\s*\/Image/g) ?? []).length).toBe(0)
  })
})

// A minimal but genuinely decodable 1×1 PNG.
const REAL_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64')
