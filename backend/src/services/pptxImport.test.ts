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
    expect(await importPptx(Buffer.from('это не презентация'))).toEqual({ slides: [], sourceSlideCount: 0, imported: [] })
  })
})

describe('toTypedSlides', () => {
  it('only treats the first slide as a title when it looks like one', () => {
    const dense = toTypedSlides([{ title: 'Повестка', bullets: ['раз', 'два', 'три', 'четыре'], notes: '', images: [] }])
    expect(dense[0].type).toBe('bullets')   // four bullets is an agenda, not a cover
  })

  it('carries the subtitle and lecturer off a cover slide', () => {
    const [slide] = toTypedSlides([{ title: 'Лекция 1', bullets: ['Гидравлика', 'Иванов И.И.'], notes: '', images: [] }])
    expect(slide).toMatchObject({ type: 'title', body: { subtitle: 'Гидравлика', lecturer: 'Иванов И.И.' } })
  })
})

describe('run boundaries', () => {
  // PowerPoint splits one line into a new <a:r> at every formatting change and
  // leaves the space on the preceding run. The XML parser trims each value by
  // default, so those spaces disappeared and the words were welded together —
  // a real deck imported as «ВСС на базеЖКВН» (production, 2026-09-08). This
  // app's own exporter writes one run per line, so the round-trip tests above
  // could never have caught it; this fixture is hand-built for that reason.
  const minimalPptx = async (paragraphXml: string): Promise<Buffer> => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('ppt/presentation.xml',
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst>' +
      '<p:sldId id="256" r:id="rId1"/></p:sldIdLst></p:presentation>')
    zip.file('ppt/_rels/presentation.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>')
    zip.file('ppt/slides/slide1.xml',
      '<p:sld xmlns:p="p" xmlns:a="a"><p:cSld><p:spTree><p:sp><p:nvSpPr><p:nvPr>' +
      '<p:ph type="ctrTitle"/></p:nvPr></p:nvSpPr><p:txBody>' + paragraphXml +
      '</p:txBody></p:sp></p:spTree></p:cSld></p:sld>')
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
  }

  it('keeps the space a formatting change left on the preceding run', async () => {
    const pptx = await minimalPptx(
      '<a:p><a:r><a:t>ВСС на базе </a:t></a:r><a:r><a:t>ЖКВН</a:t></a:r></a:p>')
    const [slide] = await extractPptxSlides(pptx)
    expect(slide.title).toBe('ВСС на базе ЖКВН')
  })

  it('treats a soft line break as a word boundary', async () => {
    const pptx = await minimalPptx(
      '<a:p><a:r><a:t>Рис. 1.</a:t></a:r><a:br/><a:r><a:t>Схема насоса</a:t></a:r></a:p>')
    const [slide] = await extractPptxSlides(pptx)
    expect(slide.title).toBe('Рис. 1. Схема насоса')
  })

  it('still collapses the whitespace a prettified deck carries between runs', async () => {
    const pptx = await minimalPptx(
      '<a:p>\n  <a:r><a:t>Кавитация</a:t></a:r>\n  <a:r><a:t>   в насосах</a:t></a:r>\n</a:p>')
    const [slide] = await extractPptxSlides(pptx)
    expect(slide.title).toBe('Кавитация в насосах')
  })
})

describe('slide pictures', () => {
  // Header-only PNGs: imageSize reads the IHDR at a fixed offset and the rest
  // of the pipeline only ever moves the bytes around, so a real encoded image
  // would add nothing but weight to the fixture.
  const png = (w: number, h: number): Buffer => {
    const buf = Buffer.alloc(33)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0)
    buf.writeUInt32BE(13, 8)
    buf.write('IHDR', 12, 'latin1')
    buf.writeUInt32BE(w, 16)
    buf.writeUInt32BE(h, 20)
    return buf
  }

  const deckWithPictures = async (
    slideBody: string,
    rels: string,
    media: Record<string, Buffer>,
  ): Promise<Buffer> => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('ppt/presentation.xml',
      '<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId id="256" r:id="rId1"/>' +
      '</p:sldIdLst></p:presentation>')
    zip.file('ppt/_rels/presentation.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/></Relationships>')
    zip.file('ppt/slides/slide1.xml',
      '<p:sld xmlns:p="p" xmlns:a="a" xmlns:r="r"><p:cSld><p:spTree>' + slideBody + '</p:spTree></p:cSld></p:sld>')
    zip.file('ppt/slides/_rels/slide1.xml.rels', rels)
    for (const [name, bytes] of Object.entries(media)) zip.file(`ppt/media/${name}`, bytes)
    return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>
  }

  const IMAGE_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
  const pic = (rId: string) =>
    `<p:pic><p:blipFill><a:blip r:embed="${rId}"/></p:blipFill></p:pic>`

  it('lifts a picture off the slide it belongs to', async () => {
    const pptx = await deckWithPictures(
      pic('rId2'),
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/image1.png"/></Relationships>`,
      { 'image1.png': png(800, 600) },
    )
    const [slide] = await extractPptxSlides(pptx)
    expect(slide.images).toHaveLength(1)
    expect(slide.images[0]).toMatchObject({ mime: 'image/png', width: 800, height: 600 })
  })

  it('keeps a slide that has a picture and no text at all', async () => {
    // A full-page schematic is precisely the slide the text-only import threw
    // away as blank — the reported deck was mostly these.
    const pptx = await deckWithPictures(
      pic('rId2'),
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/image1.png"/></Relationships>`,
      { 'image1.png': png(800, 600) },
    )
    const slides = await extractPptxSlides(pptx)
    expect(slides).toHaveLength(1)
    expect(slides[0].title).toBe('Без заголовка')
  })

  it('orders several pictures on one slide largest first', async () => {
    const pptx = await deckWithPictures(
      pic('rId2') + pic('rId3'),
      `<Relationships>
         <Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/small.png"/>
         <Relationship Id="rId3" Type="${IMAGE_REL}" Target="../media/big.png"/>
       </Relationships>`,
      { 'small.png': png(200, 150), 'big.png': png(900, 700) },
    )
    const [slide] = await extractPptxSlides(pptx)
    expect(slide.images.map((i) => i.width)).toEqual([900, 200])
  })

  it('ignores a picture used as a shape fill, not as content', async () => {
    // <a:blip> also appears in fills and in the layout background. Importing
    // those would stamp the same texture onto every slide as its illustration.
    const pptx = await deckWithPictures(
      '<p:sp><p:spPr><a:blipFill><a:blip r:embed="rId2"/></a:blipFill></p:spPr></p:sp>',
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/bg.png"/></Relationships>`,
      { 'bg.png': png(1920, 1080) },
    )
    const slides = await extractPptxSlides(pptx)
    expect(slides).toHaveLength(0)
  })

  it('skips furniture — a crest or a bullet glyph is not the drawing', async () => {
    const pptx = await deckWithPictures(
      pic('rId2'),
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/icon.png"/></Relationships>`,
      { 'icon.png': png(48, 48) },
    )
    const slides = await extractPptxSlides(pptx)
    expect(slides).toHaveLength(0)
  })

  it('skips a format it cannot measure or embed (EMF, SVG, video poster)', async () => {
    const pptx = await deckWithPictures(
      pic('rId2'),
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/drawing.emf"/></Relationships>`,
      { 'drawing.emf': Buffer.alloc(4000, 1) },
    )
    expect(await extractPptxSlides(pptx)).toHaveLength(0)
  })

  it('ignores an image that is linked rather than embedded', async () => {
    const pptx = await deckWithPictures(
      pic('rId2'),
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="https://example.org/x.png" TargetMode="External"/></Relationships>`,
      {},
    )
    expect(await extractPptxSlides(pptx)).toHaveLength(0)
  })

  it('counts the same picture placed twice on a slide once', async () => {
    const pptx = await deckWithPictures(
      pic('rId2') + pic('rId2'),
      `<Relationships><Relationship Id="rId2" Type="${IMAGE_REL}" Target="../media/image1.png"/></Relationships>`,
      { 'image1.png': png(800, 600) },
    )
    const [slide] = await extractPptxSlides(pptx)
    expect(slide.images).toHaveLength(1)
  })
})
