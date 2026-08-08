import { logger } from '../lib/logger'
import { renderFormulaToPng } from './formulaRenderer'
import type {
  Presentation, Slide, SlideImage, TitleSlide, BulletsSlide, ConceptSlide, FormulaSlide,
  ComparisonSlide, DiagramSlide, DiscussionSlide, SummarySlide,
} from '../../../shared/types'

// Real PowerPoint export (TODO.md Feature D). pptxgenjs is imported lazily so
// the rest of the backend boots even if the package isn't installed yet —
// same posture as docx in fosExport.ts / pdfkit in programReportPdf.ts.
//
// pptxgenjs has no math typesetting of its own, and the [N] citation chips
// the web viewer shows are a web-only affordance. cleanForSlide() strips
// citations from prose text. For formula slides, addFormulaSlide() renders
// each formula to a PNG via formulaRenderer.ts (MathJax → SVG → resvg),
// matching the KaTeX-rendered web viewer. If that rendering isn't available
// (packages not installed) or fails for a given formula, it falls back to
// the Unicode flattening in latexToPlainText() below rather than leaving
// raw commands like "\rho" or "^2" sitting in the slide text — that reads as
// broken markup, not math.

const C = {
  ink:        '1A1A1A',
  ink2:       '6B6560',
  ink3:       'A09890',
  amber:      'C8860A',
  amberLight: 'FDF3DC',
  border:     'E7E2D9',
  bg:         'F7F5F0',
  white:      'FFFFFF',
}

const SLIDE_W = 10      // inches, 16:9
const SLIDE_H = 5.63
const MARGIN  = 0.6

// Best-effort remote image fetch for diagram slides — never blocks the
// export. A failure (network, non-image content, timeout) falls back to a
// text placeholder rather than a broken/empty picture frame.
const IMAGE_FETCH_TIMEOUT_MS = 10_000

// ─── LaTeX → plain Unicode (best-effort, not a real TeX engine) ────────────
//
// Covers what actually shows up in this app's generated formulas (Greek
// letters, \frac, \sqrt, basic operators, ^/_ scripts) and falls back to
// stripping the backslash rather than leaving a raw "\command" behind for
// anything it doesn't recognise.

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'π',
  rho: 'ρ', varrho: 'ρ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
  phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ',
  Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν',
  Xi: 'Ξ', Omicron: 'Ο', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ',
  Phi: 'Φ', Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
}

const SYMBOLS: Record<string, string> = {
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈', equiv: '≡',
  infty: '∞', sum: 'Σ', int: '∫', partial: '∂', nabla: '∇', propto: '∝',
  to: '→', rightarrow: '→', leftarrow: '←', Rightarrow: '⇒', leftrightarrow: '↔',
  degree: '°', circ: '°', ldots: '…', cdots: '…', prime: '′',
}

const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '+': '⁺', '-': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', 'n': 'ⁿ', 'i': 'ⁱ',
}
const SUBSCRIPT: Record<string, string> = {
  '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉',
  '+': '₊', '-': '₋', '=': '₌', '(': '₍', ')': '₎',
}

// Longest name first so `\varrho` doesn't half-match on `\rho`.
const COMMAND_NAMES = [...Object.keys(GREEK), ...Object.keys(SYMBOLS)].sort((a, b) => b.length - a.length)
const COMMAND_RE = new RegExp(`\\\\(${COMMAND_NAMES.join('|')})(?![a-zA-Z])`, 'g')

// Converts every char via `map` only when ALL of them have a Unicode
// super/subscript form; otherwise falls back to `marker + content` (e.g.
// "_max") so a non-numeric script reads as readable ASCII instead of
// silently losing its separator ("a_{max}" → "amax" would look like a typo).
function scriptOrFallback(content: string, map: Record<string, string>, marker: string): string {
  const chars = [...content]
  return chars.every((ch) => ch in map)
    ? chars.map((ch) => map[ch]).join('')
    : marker + content
}

export function latexToPlainText(input: string): string {
  let s = input

  // \frac{a}{b} → (a)/(b); \sqrt{x} → √(x). Allows ONE level of nested
  // braces inside each argument — real formulas commonly subscript a
  // variable inside a \frac, e.g. \frac{P_{полезн}}{P_{затрач}}, and a
  // brace-free-only pattern fails to match the whole thing, falling through
  // to the generic cleanup and producing "fracP_..." garbage. Two levels of
  // nesting essentially never shows up in a lecture-slide formula, so this
  // stops there rather than hand-rolling a full brace-balancing parser.
  const ARG = String.raw`((?:[^{}]|\{[^{}]*\})*)`
  s = s.replace(new RegExp(String.raw`\\frac\{${ARG}\}\{${ARG}\}`, 'g'), (_m, a, b) => `(${a})/(${b})`)
  s = s.replace(new RegExp(String.raw`\\sqrt\{${ARG}\}`, 'g'), (_m, a) => `√(${a})`)
  s = s.replace(/\\sqrt(\w)/g, (_m, a) => `√${a}`)

  s = s.replace(COMMAND_RE, (_m, name) => GREEK[name] ?? SYMBOLS[name] ?? name)

  s = s.replace(/\^\{([^{}]+)\}/g, (_m, a) => scriptOrFallback(a, SUPERSCRIPT, '^'))
  s = s.replace(/\^(\S)/g, (_m, a) => scriptOrFallback(a, SUPERSCRIPT, '^'))
  s = s.replace(/_\{([^{}]+)\}/g, (_m, a) => scriptOrFallback(a, SUBSCRIPT, '_'))
  s = s.replace(/_(\S)/g, (_m, a) => scriptOrFallback(a, SUBSCRIPT, '_'))

  // Anything left with a backslash command we don't know — drop the
  // backslash but keep the word (reads as prose, not broken markup).
  s = s.replace(/\\([a-zA-Z]+)/g, '$1')
  s = s.replace(/\\/g, '')
  s = s.replace(/[{}]/g, '')   // leftover braces from unhandled groups

  return s.replace(/[ \t]{2,}/g, ' ').trim()
}

export function cleanForSlide(text: string): string {
  return text
    .replace(/\[(\d+(?:\s*,\s*\d+)*)\]/g, '')                        // strip [N] / [N, M] citation markers
    .replace(/\$\$([^$]*)\$\$/g, (_m, inner) => latexToPlainText(inner))
    .replace(/\$([^$]*)\$/g, (_m, inner) => latexToPlainText(inner))
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

async function fetchImageAsDataUri(url: string): Promise<string | null> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), IMAGE_FETCH_TIMEOUT_MS)
    let res: Response
    try {
      res = await fetch(url, { signal: controller.signal })
    } finally {
      clearTimeout(timeout)
    }
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const buf = Buffer.from(await res.arrayBuffer())
    return `data:${contentType};base64,${buf.toString('base64')}`
  } catch (err) {
    logger.warn({ message: '[PPTX export] could not fetch slide image, using placeholder', url, error: (err as Error).message })
    return null
  }
}

// ─── Side-image layout (TODO.md Feature AG Phase 2 gap) ───────────────────
//
// Non-diagram slides can carry a supplementary top-level image now (see
// shared/types.ts's SlideBase) — the web viewer already renders it below
// the slide body; PPTX export renders it as a right-hand column instead,
// shrinking the text content region rather than overlapping it. Diagram
// keeps its own dedicated full-width layout (addDiagramSlide) — this is
// only for the OTHER content types (bullets/concept/formula/comparison/
// discussion). Title/summary never carry a top-level image (the picker UI
// doesn't offer one there), so they're not handled here.

const SIDE_IMAGE_W = 3.0
const SIDE_IMAGE_GAP = 0.3

// Never hand pptxgenjs a non-positive or non-finite extent — DrawingML
// requires cx/cy > 0, and a negative one makes PowerPoint refuse to open the
// deck ("PowerPoint found a problem with content..."), which is exactly what
// a formula slide used to produce once its stacked images overran the slide
// height. Overflowing the slide edge is merely ugly; a negative extent is
// fatal, so every dynamically-computed height goes through here.
const MIN_SHAPE_H = 0.2
function clampH(h: number): number {
  return Number.isFinite(h) && h > MIN_SHAPE_H ? h : MIN_SHAPE_H
}

/** Text content region for a slide, narrower when a side image is present. */
function contentRegion(hasImage: boolean): { x: number; w: number } {
  const fullW = SLIDE_W - MARGIN * 2
  return hasImage
    ? { x: MARGIN, w: fullW - SIDE_IMAGE_W - SIDE_IMAGE_GAP }
    : { x: MARGIN, w: fullW }
}

async function addSideImage(pptxSlide: Pptx, image: SlideImage | null | undefined): Promise<void> {
  if (!image) return
  const x = SLIDE_W - MARGIN - SIDE_IMAGE_W
  const y = 1.3
  const h = SLIDE_H - y - 0.3
  const data = await fetchImageAsDataUri(image.url)
  if (data) {
    pptxSlide.addImage({ data, x, y, w: SIDE_IMAGE_W, h, sizing: { type: 'contain', w: SIDE_IMAGE_W, h } })
  } else {
    pptxSlide.addShape('rect', {
      x, y, w: SIDE_IMAGE_W, h,
      fill: { color: C.bg }, line: { color: C.border, width: 1, dashType: 'dash' },
    })
    pptxSlide.addText('Изображение недоступно для экспорта', {
      x, y, w: SIDE_IMAGE_W, h, align: 'center', valign: 'middle', fontSize: 10, italic: true, color: C.ink3,
    })
  }
}

export async function generatePresentationPptx(presentation: Presentation): Promise<Buffer> {
  const slides = presentation.slides
  if (!slides || slides.length === 0) {
    throw new Error('У презентации нет слайдов для экспорта — сгенерируйте её заново.')
  }

  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'ISPUM_16_9', width: SLIDE_W, height: SLIDE_H })
  pptx.layout = 'ISPUM_16_9'
  pptx.author = 'ИСПУМ'
  pptx.title  = presentation.topic

  // Sequential, not Promise.all — a diagram slide's image fetch has no
  // reason to race the others, and pptxgenjs slides render in call order.
  for (const slide of slides) {
    await addSlide(pptx, slide)
  }

  const data = await pptx.write({ outputType: 'nodebuffer' })
  return fixDanglingSlideMasterEntries(data as Buffer)
}

// ─── Work around a pptxgenjs 4.0.1 packaging bug ───────────────────────────
//
// createContentTypesXml() in the library writes one `<Override .../ppt/
// slideMasters/slideMasterN.xml>` entry PER SLIDE (using the slide's index,
// not the actual master count) — see `slides.forEach((slide, idx) => ...
// slideMaster${idx + 1}.xml ...)` in pptxgenjs/dist/pptxgen.cjs.js. This
// deck never calls defineSlideMaster(), so there is exactly one real
// ppt/slideMasters/slideMaster1.xml — every deck with 2+ slides therefore
// ships a [Content_Types].xml that references slideMaster2.xml,
// slideMaster3.xml, etc. that don't exist in the zip. PowerPoint's strict
// OOXML validator flags that as corruption ("PowerPoint found a problem
// with content...") and auto-repairs by stripping parts, which is exactly
// the dialog a teacher hit on a real multi-slide deck. Rather than patching
// the installed library (fragile across npm installs) or forking it, strip
// the dangling Overrides from the already-written zip before returning it —
// jszip is already a transitive dependency of pptxgenjs, so this reuses it
// rather than adding another zip library.
async function fixDanglingSlideMasterEntries(pptxBuffer: Buffer): Promise<Buffer> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(pptxBuffer)

  const realMasterCount = Object.keys(zip.files)
    .filter((name) => /^ppt\/slideMasters\/slideMaster\d+\.xml$/.test(name)).length

  const contentTypesFile = zip.file('[Content_Types].xml')
  if (!contentTypesFile) return pptxBuffer // unexpected shape — leave the buffer untouched rather than guess
  let xml = await contentTypesFile.async('string')

  const danglingRe = /<Override PartName="\/ppt\/slideMasters\/slideMaster(\d+)\.xml"[^>]*\/>/g
  xml = xml.replace(danglingRe, (match, n) => (Number(n) > realMasterCount ? '' : match))

  zip.file('[Content_Types].xml', xml)
  return zip.generateAsync({ type: 'nodebuffer' })
}

// ─── Per-slide-type rendering ──────────────────────────────────────────────

// `any` here keeps every helper below from importing pptxgenjs's type surface
// just for a parameter annotation — the lazy `import()` above is already the
// only place the package is referenced by name, matching fosExport.ts's docx
// posture (import lazily, don't spread the dependency across the file).
type Pptx = any

async function addSlide(pptx: Pptx, slide: Slide): Promise<void> {
  switch (slide.type) {
    case 'title':      addTitleSlide(pptx, slide); return
    case 'bullets':    await addBulletsSlide(pptx, slide); return
    case 'concept':    await addConceptSlide(pptx, slide); return
    case 'formula':    await addFormulaSlide(pptx, slide); return
    case 'comparison': await addComparisonSlide(pptx, slide); return
    case 'diagram':    await addDiagramSlide(pptx, slide); return
    case 'discussion': await addDiscussionSlide(pptx, slide); return
    case 'summary':    addSummarySlide(pptx, slide); return
  }
}

function addNotes(pptxSlide: Pptx, notes: string): void {
  if (notes) pptxSlide.addNotes(cleanForSlide(notes))
}

// Shared header bar used by every non-title slide — amber accent rule +
// title text, so the deck reads as one system rather than one layout per type.
function addHeader(pptxSlide: Pptx, title: string): void {
  pptxSlide.background = { color: C.white }
  pptxSlide.addShape('rect', { x: 0, y: 0, w: SLIDE_W, h: 0.12, fill: { color: C.amber } })
  pptxSlide.addText(cleanForSlide(title), {
    x: MARGIN, y: 0.3, w: SLIDE_W - MARGIN * 2, h: 0.7,
    fontFace: 'Georgia', fontSize: 24, bold: true, color: C.ink,
  })
}

function bulletList(items: string[]): { text: string; options: { bullet: boolean; breakLine: boolean } }[] {
  return items.map((t) => ({ text: cleanForSlide(t), options: { bullet: true, breakLine: true } }))
}

function addTitleSlide(pptx: Pptx, slide: TitleSlide): void {
  const s = pptx.addSlide()
  s.background = { color: C.ink }
  if (slide.body.subtitle) {
    s.addText(cleanForSlide(slide.body.subtitle), {
      x: MARGIN, y: 1.5, w: SLIDE_W - MARGIN * 2, h: 0.5,
      align: 'center', fontSize: 14, color: C.amber,
    })
  }
  s.addText(cleanForSlide(slide.title), {
    x: MARGIN, y: 2.0, w: SLIDE_W - MARGIN * 2, h: 1.4,
    align: 'center', valign: 'middle', fontFace: 'Georgia', fontSize: 30, bold: true, color: C.white,
  })
  if (slide.body.lecturer) {
    s.addText(cleanForSlide(slide.body.lecturer), {
      x: MARGIN, y: 3.6, w: SLIDE_W - MARGIN * 2, h: 0.5,
      align: 'center', fontSize: 12, color: C.border,
    })
  }
  addNotes(s, slide.notes)
}

async function addBulletsSlide(pptx: Pptx, slide: BulletsSlide): Promise<void> {
  const s = pptx.addSlide()
  addHeader(s, slide.title)
  const region = contentRegion(Boolean(slide.image))
  if (slide.body.items.length > 0) {
    s.addText(bulletList(slide.body.items), {
      x: region.x, y: 1.3, w: region.w, h: SLIDE_H - 1.6,
      fontSize: 16, color: C.ink, valign: 'top', lineSpacingMultiple: 1.3,
    })
  }
  await addSideImage(s, slide.image)
  addNotes(s, slide.notes)
}

async function addConceptSlide(pptx: Pptx, slide: ConceptSlide): Promise<void> {
  const s = pptx.addSlide()
  addHeader(s, slide.title)
  const region = contentRegion(Boolean(slide.image))
  s.addText(cleanForSlide(slide.body.definition), {
    x: region.x, y: 1.3, w: region.w, h: 1.2,
    fontSize: 18, italic: true, color: C.ink, valign: 'top',
    fill: { color: C.amberLight },
  })
  if (slide.body.supporting.length > 0) {
    s.addText(bulletList(slide.body.supporting), {
      x: region.x, y: 2.7, w: region.w, h: SLIDE_H - 3.0,
      fontSize: 14, color: C.ink2, valign: 'top', lineSpacingMultiple: 1.3,
    })
  }
  await addSideImage(s, slide.image)
  addNotes(s, slide.notes)
}

// Formula-slide vertical layout. A rendered formula IMAGE is far taller than
// the single line of text it replaced, so the per-formula height has to be
// budgeted against the slide rather than taken as a flat cap: four formulas
// at the old flat 1.8" cap (plus captions) ran `y` to 9.57" on a 5.63"
// slide, and the explanation box below then got a NEGATIVE height —
// invalid DrawingML that makes PowerPoint refuse to open the deck
// ("PowerPoint found a problem with content..."). Budget first, then clamp.
const FORMULA_IMG_MAX_H  = 1.8   // tallest a single formula may render
const FORMULA_IMG_MIN_H  = 0.3   // floor, so a formula-dense slide still shows something
const FORMULA_TOP        = 1.4   // below the header bar
const FORMULA_BOTTOM_PAD = 0.3
const FORMULA_CAPTION_H  = 0.35
const FORMULA_GAP        = 0.08
const EXPLANATION_RESERVE = 0.9  // vertical space held back for body.explanation

async function addFormulaSlide(pptx: Pptx, slide: FormulaSlide): Promise<void> {
  const s = pptx.addSlide()
  addHeader(s, slide.title)
  const region = contentRegion(Boolean(slide.image))

  const formulas = slide.body.formulas
  const hasExplanation = Boolean(slide.body.explanation)

  // Share the free vertical space between the formulas, so N formulas
  // always fit regardless of how tall each one would render on its own.
  const available = SLIDE_H - FORMULA_TOP - FORMULA_BOTTOM_PAD
    - (hasExplanation ? EXPLANATION_RESERVE : 0)
  const perFormula = formulas.length > 0 ? available / formulas.length : available

  let y = FORMULA_TOP
  for (const f of formulas) {
    const captionH = f.caption ? FORMULA_CAPTION_H : 0
    const bodyBudget = Math.max(FORMULA_IMG_MIN_H, perFormula - captionH - FORMULA_GAP)

    // f.latex is raw LaTeX with no surrounding $ delimiters (per the Slide
    // type). Prefer a rendered PNG (matches the KaTeX web viewer); fall back
    // to the Unicode flattening in latexToPlainText() if MathJax/resvg
    // aren't installed or fail to render this particular formula.
    const rendered = await renderFormulaToPng(f.latex, `#${C.ink}`)
    if (rendered && Number.isFinite(rendered.aspect) && rendered.aspect > 0) {
      const maxH = Math.min(FORMULA_IMG_MAX_H, bodyBudget)
      let w = region.w * 0.85
      let h = w / rendered.aspect
      if (h > maxH) {
        h = maxH
        w = h * rendered.aspect
      }
      const x = region.x + (region.w - w) / 2
      s.addImage({ data: rendered.dataUri, x, y, w, h })
      y += h + FORMULA_GAP
    } else {
      const h = Math.min(0.7, bodyBudget)
      s.addText(latexToPlainText(f.latex), {
        x: region.x, y, w: region.w, h: clampH(h),
        align: 'center', fontFace: 'Cambria Math', fontSize: 20, color: C.ink,
      })
      y += h + FORMULA_GAP
    }

    if (f.caption) {
      s.addText(cleanForSlide(f.caption), {
        x: region.x, y, w: region.w, h: FORMULA_CAPTION_H,
        align: 'center', fontSize: 12, italic: true, color: C.ink3,
      })
      y += captionH
    }
  }

  if (hasExplanation) {
    s.addText(cleanForSlide(slide.body.explanation!), {
      x: region.x, y: y + 0.1, w: region.w, h: clampH(SLIDE_H - y - 0.1 - FORMULA_BOTTOM_PAD),
      fontSize: 14, color: C.ink2, valign: 'top',
    })
  }
  await addSideImage(s, slide.image)
  addNotes(s, slide.notes)
}

async function addComparisonSlide(pptx: Pptx, slide: ComparisonSlide): Promise<void> {
  const s = pptx.addSlide()
  addHeader(s, slide.title)
  const region = contentRegion(Boolean(slide.image))
  const cols = slide.body.columns
  const gap = 0.3
  const colW = (region.w - gap * (cols.length - 1)) / cols.length
  cols.forEach((c, i) => {
    const x = region.x + i * (colW + gap)
    s.addShape('rect', { x, y: 1.3, w: colW, h: 0.5, fill: { color: C.bg }, line: { color: C.border, width: 0.5 } })
    s.addText(cleanForSlide(c.header).toUpperCase(), {
      x, y: 1.3, w: colW, h: 0.5, align: 'center', valign: 'middle',
      fontSize: 12, bold: true, color: C.amber,
    })
    if (c.items.length > 0) {
      s.addText(bulletList(c.items), {
        x, y: 1.9, w: colW, h: SLIDE_H - 2.2, fontSize: 12, color: C.ink, valign: 'top',
      })
    }
  })
  await addSideImage(s, slide.image)
  addNotes(s, slide.notes)
}

async function addDiagramSlide(pptx: Pptx, slide: DiagramSlide): Promise<void> {
  const s = pptx.addSlide()
  addHeader(s, slide.title)

  const imgBoxY = 1.3
  const imgBoxH = 2.9
  const data = slide.body.image ? await fetchImageAsDataUri(slide.body.image.url) : null

  if (data) {
    s.addImage({ data, x: 2.5, y: imgBoxY, w: 5, h: imgBoxH, sizing: { type: 'contain', w: 5, h: imgBoxH } })
  } else {
    s.addShape('rect', {
      x: MARGIN, y: imgBoxY, w: SLIDE_W - MARGIN * 2, h: imgBoxH,
      fill: { color: C.bg }, line: { color: C.border, width: 1, dashType: 'dash' },
    })
    s.addText(
      slide.body.image
        ? 'Изображение недоступно для экспорта — откройте презентацию в ИСПУМ'
        : `Изображение не выбрано: «${cleanForSlide(slide.body.image_query)}»`,
      {
        x: MARGIN, y: imgBoxY, w: SLIDE_W - MARGIN * 2, h: imgBoxH,
        align: 'center', valign: 'middle', fontSize: 12, italic: true, color: C.ink3,
      },
    )
  }

  let y = imgBoxY + imgBoxH + 0.15
  if (slide.body.caption) {
    s.addText(cleanForSlide(slide.body.caption), {
      x: MARGIN, y, w: SLIDE_W - MARGIN * 2, h: 0.35, align: 'center', fontSize: 12, bold: true, color: C.ink,
    })
    y += 0.35
  }
  if (slide.body.points.length > 0) {
    s.addText(bulletList(slide.body.points), {
      x: MARGIN, y, w: SLIDE_W - MARGIN * 2, h: clampH(SLIDE_H - y - 0.2), fontSize: 11, color: C.ink2, valign: 'top',
    })
  }
  addNotes(s, slide.notes)
}

async function addDiscussionSlide(pptx: Pptx, slide: DiscussionSlide): Promise<void> {
  const s = pptx.addSlide()
  addHeader(s, slide.title)
  const region = contentRegion(Boolean(slide.image))
  s.addText(cleanForSlide(slide.body.question), {
    x: region.x, y: 1.3, w: region.w, h: 1.0,
    fontFace: 'Georgia', fontSize: 20, bold: true, color: C.ink, valign: 'top',
  })
  if (slide.body.prompts.length > 0) {
    s.addText(bulletList(slide.body.prompts), {
      x: region.x, y: 2.4, w: region.w, h: SLIDE_H - 2.7,
      fontSize: 14, color: C.ink2, valign: 'top',
    })
  }
  await addSideImage(s, slide.image)
  addNotes(s, slide.notes)
}

function addSummarySlide(pptx: Pptx, slide: SummarySlide): void {
  const s = pptx.addSlide()
  addHeader(s, slide.title)
  const half = (SLIDE_W - MARGIN * 2 - 0.3) / 2
  if (slide.body.takeaways.length > 0) {
    s.addText('ГЛАВНОЕ', { x: MARGIN, y: 1.3, w: half, h: 0.35, fontSize: 11, bold: true, color: C.amber })
    s.addText(bulletList(slide.body.takeaways), {
      x: MARGIN, y: 1.7, w: half, h: SLIDE_H - 2.0, fontSize: 13, color: C.ink, valign: 'top',
    })
  }
  if (slide.body.next_steps.length > 0) {
    const x = MARGIN + half + 0.3
    s.addText('ЧТО ДАЛЬШЕ', { x, y: 1.3, w: half, h: 0.35, fontSize: 11, bold: true, color: C.amber })
    s.addText(bulletList(slide.body.next_steps), {
      x, y: 1.7, w: half, h: SLIDE_H - 2.0, fontSize: 13, color: C.ink2, valign: 'top',
    })
  }
  addNotes(s, slide.notes)
}
