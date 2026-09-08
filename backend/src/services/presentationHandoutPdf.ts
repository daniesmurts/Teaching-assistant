import path from 'path'
import { latexToPlainText } from './presentationExport'
import { loadSlideImage } from './slideImageSource'
import { imageSize } from '../lib/imageSize'
import { logger } from '../lib/logger'
import type { Presentation, Slide, SlideImage } from '../../../shared/types'

// Раздатка — the student-facing companion to a lecture deck (TODO.md "### AO"
// Phase 3). The PPTX export is what the teacher projects; this is what the
// students take away: the same material laid out to be read rather than
// presented — full sentences from the speaker notes instead of one-word
// bullets on a slide, and no image placeholders or production notes.
//
// Hand-laid with pdfkit, same posture as programReportPdf.ts: no headless
// Chrome (keeps us off Google infra and working offline on the Yandex VM),
// vendored PT Serif/PT Sans so Cyrillic renders natively.
//
// Deliberately NOT an LLM call. The speaker notes are already continuous
// Russian prose explaining the slide — rewriting them into "student voice"
// would cost a call per deck and risk changing what the lecture actually
// said. The teacher chooses whether to include them at all.

const C = {
  ink:    '#1A1A1A',
  ink2:   '#6B6560',
  ink3:   '#A09890',
  amber:  '#C8860A',
  border: '#E7E2D9',
}

const FONT_DIR = path.join(process.cwd(), 'assets', 'fonts')
const FONTS = {
  serif:  path.join(FONT_DIR, 'PTSerif-Bold.ttf'),
  serifR: path.join(FONT_DIR, 'PTSerif-Regular.ttf'),
  sans:   path.join(FONT_DIR, 'PTSans-Regular.ttf'),
  sansB:  path.join(FONT_DIR, 'PTSans-Bold.ttf'),
  // Same four weights in DejaVu, used only for a paragraph PT cannot draw —
  // see assets/fonts/README.md. Registered up front rather than lazily: a
  // pdfkit font must exist before the first text() that names it, and the
  // whole point is that we don't know which paragraph will need it.
  serifX:  path.join(FONT_DIR, 'DejaVuSerif-Bold.ttf'),
  serifRX: path.join(FONT_DIR, 'DejaVuSerif.ttf'),
  sansX:   path.join(FONT_DIR, 'DejaVuSans.ttf'),
  sansBX:  path.join(FONT_DIR, 'DejaVuSans-Bold.ttf'),
}

type FontName = 'serif' | 'serifR' | 'sans' | 'sansB'

// The DejaVu face of the same weight, for text PT can't set.
const FALLBACK: Record<FontName, keyof typeof FONTS> = {
  serif:  'serifX',
  serifR: 'serifRX',
  sans:   'sansX',
  sansB:  'sansBX',
}

// Characters the vendored PT faces lack, as ranges rather than a list: Greek
// (U+0370–U+03FF), arrows (U+2190–U+21FF) and mathematical operators
// (U+2200–U+22FF). PT does have a few of these — ∑ ∫ ∂ ≈ ≤ ≥ ∞ — so a
// paragraph containing one swaps to DejaVu unnecessarily; that is a texture
// change nobody will notice, where the alternative is a tofu box somebody
// will. Sub/superscript digits (U+2070–U+209F) are deliberately NOT here:
// latexToPlainText emits them constantly and PT draws them fine, so
// triggering on them would set every formula in the fallback face.
const NEEDS_FALLBACK = /[\u0370-\u03FF\u2190-\u21FF\u2200-\u22FF]/

/**
 * Which face to actually draw `text` in. Exported for testing: the failure it
 * prevents is silent — pdfkit renders a missing glyph as a box and reports
 * nothing, so nothing but a rule like this (or a human looking at the PDF)
 * catches it.
 */
export function faceFor(font: FontName, text: string): keyof typeof FONTS {
  return NEEDS_FALLBACK.test(text) ? FALLBACK[font] : font
}

export interface HandoutOptions {
  /** Speaker notes as the reading text. Off → titles and slide content only,
   *  i.e. a skeleton to take notes on rather than a ready конспект. */
  includeNotes?: boolean
  /** Teacher's display name for the title page, when we have one. */
  lecturer?: string | null
}

// Inline math is allowed in every slide text field (the expansion prompt
// invites `$Q$`, `$\eta$`), and printed raw it reads as broken markup.
const INLINE_MATH = /\$([^$\n]{1,200})\$/g

// Citation markers are a web-viewer affordance (they open a source popover
// nothing in a PDF can open) and read as noise on paper — same treatment
// presentationExport.ts's cleanForSlide gives them. Removing "[1]" from
// "…насыщения [1]." leaves "…насыщения ." — so the space before the
// punctuation goes with it, or every cited sentence ends with a floating dot.
function clean(text: string): string {
  return text
    .replace(/\[\d+(?:\s*,\s*\d+)*\]/g, '')
    .replace(INLINE_MATH, (_, math: string) => latexToPlainText(math))
    .replace(/\s+([,.;:!?)])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ─── Pictures ────────────────────────────────────────────────────────────────
//
// A slide's picture is part of what the lecture said — for a схема lecture it
// is most of what it said — so the handout carries it. This reverses an
// earlier call here (images left out because a web photo prints as a grey
// smudge in greyscale), which was right about photos and wrong as a blanket
// rule: the pictures that now reach a deck are mostly line drawings imported
// from the teacher's own .pptx, which is exactly the kind of image that
// survives a departmental laser printer.
//
// pdfkit embeds PNG and JPEG and nothing else — an unsupported format throws
// mid-document, taking the whole handout with it. imageSize() returns
// dimensions only for those two, so it doubles as the format gate.
const IMAGE_MAX_H = 240        // pt — about a third of an A4 text column
const PX_TO_PT    = 0.75       // 96 dpi source pixels → 72 dpi PDF points
const MAX_IMAGES  = 60
// Nominal height of a figure slide's text between heading and drawing.
const BODY_RESERVE = 44        // pt — about two lines of the bullet face

export interface HandoutPicture {
  buffer: Buffer
  w:      number   // points, already fitted
  h:      number
  credit: string | null
}

/** The image a slide carries, wherever that slide type keeps it. */
function slideImageOf(slide: Slide): SlideImage | null {
  return (slide.type === 'diagram' ? slide.body.image : slide.image) ?? null
}

/**
 * Load and measure every slide's picture BEFORE the document is laid out.
 *
 * pdfkit's rendering pass is synchronous — heights are measured and pages
 * broken as it goes — so an image whose bytes arrive later cannot be
 * paginated around. Fetching up front also means one round of parallel
 * network work instead of one blocking wait per slide.
 */
export async function loadHandoutPictures(slides: Slide[], maxWidth: number): Promise<Map<number, HandoutPicture>> {
  const wanted = slides
    .map((slide, index) => ({ index, image: slideImageOf(slide) }))
    .filter((c): c is { index: number; image: SlideImage } => c.image !== null && Boolean(c.image.url))
    .slice(0, MAX_IMAGES)

  const loaded = await Promise.all(wanted.map(async ({ index, image }) => {
    const found = await loadSlideImage(image.url)
    if (!found) return null

    const size = imageSize(found.buffer)
    if (!size) {
      // WebP, SVG, GIF — pdfkit would throw on these, and a handout that
      // fails to generate is worse than one printed without a picture.
      logger.warn({ message: '[handout] skipping an image pdfkit cannot embed', url: image.url, mime: found.mime })
      return null
    }

    // Never upscaled past its own resolution: a 200 px schematic blown up to
    // the column width prints worse than the same drawing left small.
    const scale = Math.min(maxWidth / (size.width * PX_TO_PT), IMAGE_MAX_H / (size.height * PX_TO_PT), 1)
    return {
      index,
      picture: {
        buffer: found.buffer,
        w: size.width  * PX_TO_PT * scale,
        h: size.height * PX_TO_PT * scale,
        // Only a web image needs crediting; a picture out of the teacher's own
        // deck does not, and "Источник: Из загруженной презентации" under
        // every drawing is noise on a page students are meant to read.
        credit: image.url.startsWith('/') ? null : (image.source_host || null),
      },
    }
  }))

  return new Map(loaded.filter((l): l is { index: number; picture: HandoutPicture } => l !== null)
    .map((l) => [l.index, l.picture]))
}

export async function generatePresentationHandoutPdf(
  presentation: Presentation,
  options: HandoutOptions = {},
): Promise<Buffer> {
  const { default: PDFDocument } = await import('pdfkit')
  const includeNotes = options.includeNotes !== false
  const slides = presentation.slides ?? []

  // A4 (595pt) less the two 56pt margins — the same column the text uses.
  const pictures = await loadHandoutPictures(slides, 595.28 - 56 * 2)

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 56, bufferPages: true,
      info: { Title: `${presentation.topic} — раздаточный материал`, Author: 'ИСПУМ' },
    })

    for (const [name, file] of Object.entries(FONTS)) doc.registerFont(name, file)

    const chunks: Buffer[] = []
    doc.on('data', (c: Buffer) => chunks.push(c))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    const M  = 56
    const CW = doc.page.width - M * 2
    const bottom = doc.page.height - M - 20
    let y = M

    const ensure = (h: number) => { if (y + h > bottom) { doc.addPage(); y = M } }

    const text = (
      s: string, font: FontName, size: number, color: string,
      opts: { indent?: number; gap?: number; align?: 'left' | 'center' } = {},
    ) => {
      if (!s) return
      const x = M + (opts.indent ?? 0)
      const w = CW - (opts.indent ?? 0)
      // Face chosen per paragraph, after the text is final — measuring with
      // one font and drawing with another would mis-paginate.
      doc.font(faceFor(font, s)).fontSize(size).fillColor(color)
      const h = doc.heightOfString(s, { width: w, align: opts.align, lineGap: opts.gap ?? 1.5 })
      ensure(h)
      doc.text(s, x, y, { width: w, align: opts.align, lineGap: opts.gap ?? 1.5 })
      y += h
    }

    const bullets = (items: string[], indent = 12) => {
      items.map(clean).filter(Boolean).forEach((item) => {
        text(`•  ${item}`, 'sans', 10.5, C.ink2, { indent })
        y += 2
      })
    }

    // Drawn centred with its caption, and kept whole: an image that would
    // straddle the page break moves to the next page instead of being clipped,
    // which is what `ensure` cannot express for a non-text block.
    const picture = (pic: HandoutPicture | undefined) => {
      if (!pic) return
      const creditH = pic.credit ? 12 : 0
      y += 6
      if (y + pic.h + creditH > bottom) { doc.addPage(); y = M }

      doc.image(pic.buffer, M + (CW - pic.w) / 2, y, { width: pic.w, height: pic.h })
      y += pic.h

      if (pic.credit) {
        y += 2
        doc.font('sans').fontSize(8).fillColor(C.ink3)
        doc.text(`Источник: ${pic.credit}`, M, y, { width: CW, align: 'center' })
        y += 10
      }
      y += 6
    }

    const rule = () => {
      ensure(10)
      doc.moveTo(M, y).lineTo(M + CW, y).lineWidth(1).strokeColor(C.border).stroke()
      y += 10
    }

    // ── Title block ──────────────────────────────────────────────────────────
    const meta = [
      presentation.course_name,
      presentation.lecture_number ? `Лекция ${presentation.lecture_number}` : null,
    ].filter(Boolean).join(' · ')

    if (meta) { text(meta.toUpperCase(), 'sansB', 9, C.amber); y += 6 }
    text(presentation.topic, 'serif', 22, C.ink, { gap: 2 })
    y += 4
    if (options.lecturer) text(options.lecturer, 'sans', 10.5, C.ink2)
    text(
      includeNotes
        ? 'Раздаточный материал по лекции'
        : 'План лекции — для конспектирования',
      'sans', 9.5, C.ink3,
    )
    y += 10
    rule()
    y += 4

    // ── Slides ───────────────────────────────────────────────────────────────
    //
    // Numbered by position in the handout, not by slide index: the title slide
    // is skipped (see below), and a handout that opens at "2." reads as a
    // printing error rather than a deliberate omission.
    let n = 0
    slides.forEach((slide, slideIndex) => {
      // The title slide's content is the cover of the projected deck (subject,
      // lecturer) — already on this page's title block, so repeating it here
      // would open the handout with a duplicate of itself.
      if (slide.type === 'title') return

      n += 1
      ensure(48)

      // Keep a slide's heading with its figure. These slides are typically a
      // «Рис. N» heading, one line of обозначения and the drawing — split
      // across a page break, the heading strands at the foot of one page and
      // the drawing opens the next with nothing saying what it shows. The
      // body is measured as a nominal two lines (it is a caption, not prose);
      // a long body pushes the figure down as it always did, but the heading
      // then has real content under it either way.
      const pic = pictures.get(slideIndex)
      if (pic) {
        const headingH = doc.font(faceFor('serif', slide.title)).fontSize(13.5)
          .heightOfString(`${n}. ${clean(slide.title)}`, { width: CW, lineGap: 1.5 })
        const block = headingH + BODY_RESERVE + pic.h
        // Only when the block could fit a page at all — otherwise a break
        // just adds a blank page ahead of content that must flow regardless.
        if (block <= bottom - M && y + 8 + block > bottom) { doc.addPage(); y = M }
      }

      y += 8
      text(`${n}. ${clean(slide.title)}`, 'serif', 13.5, C.ink)
      y += 4

      renderBody(slide)
      picture(pictures.get(slideIndex))

      if (includeNotes && slide.notes) {
        y += 4
        text(clean(slide.notes), 'serifR', 10.5, C.ink, { gap: 2.5 })
      }
      y += 6
    })

    function renderBody(slide: Slide): void {
      switch (slide.type) {
        case 'title':
          break
        case 'bullets':
          bullets(slide.body.items)
          break
        case 'concept':
          text(clean(slide.body.definition), 'sansB', 11, C.ink)
          y += 3
          bullets(slide.body.supporting)
          break
        case 'formula':
          // Flattened to Unicode with the PPTX exporter's own converter, not
          // printed as raw LaTeX: "NPSH = \\frac{p_1 - p_s}{\\rho g}" is
          // markup a student has to decode, while "(p₁ - p_s)/(ρg)" reads.
          // Full typesetting would need formulaRenderer.ts's MathJax→PNG path;
          // that's a heavier dependency than a handout warrants, and images
          // don't survive greyscale printing as well as text does.
          slide.body.formulas.forEach((f) => {
            text(latexToPlainText(f.latex), 'sansB', 11, C.ink, { indent: 12 })
            if (f.caption) text(clean(f.caption), 'sans', 9.5, C.ink3, { indent: 12 })
            y += 3
          })
          if (slide.body.explanation) text(clean(slide.body.explanation), 'sans', 10.5, C.ink2)
          break
        case 'comparison':
          slide.body.columns.forEach((col) => {
            text(clean(col.header), 'sansB', 10.5, C.ink, { indent: 12 })
            bullets(col.items, 24)
            y += 2
          })
          break
        case 'diagram':
          // The image itself is deliberately not embedded: a handout is
          // printed, often in greyscale, and a web-sourced photo is the first
          // thing to turn into a grey smudge. The caption and the points are
          // what carry the meaning in print.
          if (slide.body.caption) text(clean(slide.body.caption), 'sansB', 10.5, C.ink)
          bullets(slide.body.points)
          break
        case 'discussion':
          text(`? ${clean(slide.body.question)}`, 'sansB', 11, C.ink)
          y += 3
          bullets(slide.body.prompts)
          break
        case 'summary':
          bullets(slide.body.takeaways)
          if (slide.body.next_steps.length > 0) {
            y += 4
            text('Что дальше', 'sansB', 10, C.ink3)
            y += 2
            bullets(slide.body.next_steps)
          }
          break
      }
    }

    // ── Sources ──────────────────────────────────────────────────────────────
    const sources = presentation.sources ?? []
    if (sources.length > 0) {
      y += 10
      rule()
      text('Источники', 'sansB', 10, C.ink3)
      y += 4
      sources.forEach((s) => {
        const pages = s.page_start
          ? (s.page_end && s.page_end !== s.page_start ? `, стр. ${s.page_start}–${s.page_end}` : `, стр. ${s.page_start}`)
          : ''
        text(`${s.idx}. ${s.file_name}${pages}`, 'sans', 9.5, C.ink2)
      })
    }

    // ── Footer ───────────────────────────────────────────────────────────────
    const range = doc.bufferedPageRange()
    for (let p = 0; p < range.count; p++) {
      doc.switchToPage(range.start + p)
      doc.font('sans').fontSize(8).fillColor(C.ink3)
      doc.text(
        `${presentation.topic} · ${p + 1} из ${range.count}`,
        M, doc.page.height - M + 4,
        { width: CW, align: 'center', lineBreak: false },
      )
    }

    doc.end()
  })
}
