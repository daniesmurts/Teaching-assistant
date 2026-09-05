import { XMLParser } from 'fast-xml-parser'
import { logger } from '../lib/logger'
import { MAX_SLIDE_COUNT } from '../../../shared/types'
import type { Slide } from '../../../shared/types'

// «Загрузить свою презентацию» (TODO.md "### AO" Phase 4).
//
// Every prospective teacher already has a folder of lecture decks. Asking them
// to describe a lecture from scratch to see what ИСПУМ does is a much higher
// bar than "upload the one you gave last week" — and once a deck is inside,
// everything else in the feature applies to it: per-slide rewriting, the test,
// the раздатка, the письменная работа, «Готово».
//
// No LLM call. This is a faithful import, not a rewrite: what the teacher
// wrote stays theirs, and «Переписать» on any individual slide is there if
// they want the model's version. Charging an AI generation for a zip-and-XML
// read would also be indefensible.
//
// A .pptx is a zip of OOXML. The parts that matter:
//   ppt/presentation.xml            — <p:sldIdLst> gives the real slide ORDER
//   ppt/_rels/presentation.xml.rels — r:id → ppt/slides/slideN.xml
//   ppt/slides/slideN.xml           — shapes; the title placeholder is marked
//   ppt/slides/_rels/slideN.xml.rels→ slide → its notesSlide
//   ppt/notesSlides/notesSlideM.xml — speaker notes

export interface ImportedSlide {
  title:   string
  bullets: string[]
  notes:   string
}

// Repeating OOXML nodes appear as a single object when there is exactly one of
// them, and as an array when there are several. Declaring them here means the
// walk below never has to ask which shape it got.
const ARRAY_NODES = new Set([
  'p:sp', 'a:p', 'a:r', 'p:sldId', 'Relationship',
])

const parser = new XMLParser({
  ignoreAttributes:   false,
  attributeNamePrefix: '@',
  isArray: (name) => ARRAY_NODES.has(name),
})

type Node = Record<string, unknown>

function asArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined || value === null) return []
  return Array.isArray(value) ? value : [value]
}

/** Depth-first text extraction of every <a:t> under a node, in document order. */
function textRuns(node: unknown): string[] {
  if (node === null || node === undefined) return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]
  if (Array.isArray(node)) return node.flatMap(textRuns)
  if (typeof node !== 'object') return []

  const out: string[] = []
  for (const [key, value] of Object.entries(node as Node)) {
    if (key.startsWith('@')) continue
    if (key === 'a:t') { out.push(...textRuns(value)); continue }
    out.push(...textRuns(value))
  }
  return out
}

/** One paragraph's worth of text — runs inside <a:p> joined without spaces,
 *  because PowerPoint splits a single line into runs at every formatting change. */
function paragraphLines(txBody: unknown): string[] {
  const paragraphs = asArray((txBody as Node | undefined)?.['a:p'] as unknown[])
  return paragraphs
    .map((p) => textRuns(p).join('').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

/** Every line of text in a shape tree, in document order. */
function shapeTreeLines(spTree: Node | undefined): string[] {
  return asArray(spTree?.['p:sp'] as Node[] | undefined).flatMap((sp) => paragraphLines(sp['p:txBody']))
}

/** Largest run size (OOXML `sz`, hundredths of a point) anywhere in a shape.
 *  0 when the shape inherits its size from the layout, which is the common
 *  case in decks built from real templates. */
function maxFontSize(node: unknown): number {
  if (!node || typeof node !== 'object') return 0
  if (Array.isArray(node)) return Math.max(0, ...node.map(maxFontSize))

  let best = 0
  for (const [key, value] of Object.entries(node as Node)) {
    if (key === '@sz') { best = Math.max(best, Number(value) || 0); continue }
    if (key.startsWith('@')) continue
    best = Math.max(best, maxFontSize(value))
  }
  return best
}

function isTitlePlaceholder(shape: Node): boolean {
  const ph = ((shape['p:nvSpPr'] as Node | undefined)?.['p:nvPr'] as Node | undefined)?.['p:ph'] as Node | undefined
  const type = ph?.['@type']
  return type === 'title' || type === 'ctrTitle'
}

function parseSlideXml(xml: string): { title: string; bullets: string[] } {
  const doc    = parser.parse(xml) as Node
  const spTree = ((doc['p:sld'] as Node | undefined)?.['p:cSld'] as Node | undefined)?.['p:spTree'] as Node | undefined
  const shapes = asArray(spTree?.['p:sp'] as Node[] | undefined)
    .map((shape) => ({ shape, lines: paragraphLines(shape['p:txBody']) }))
    .filter((s) => s.lines.length > 0)

  if (shapes.length === 0) return { title: '', bullets: [] }

  // A shape explicitly marked as the title placeholder wins outright.
  let titleIndex = shapes.findIndex(({ shape }) => isTitlePlaceholder(shape))

  // Otherwise: the biggest text on the slide. Plenty of decks are built by
  // typing into plain text boxes rather than placeholders, and there "first
  // shape in the tree" is not the title — the exporter in this very repo
  // draws the subtitle before the topic. Font size is how a human reads which
  // line is the heading, and it is right there in the XML.
  if (titleIndex === -1) {
    const sizes = shapes.map(({ shape }) => maxFontSize(shape))
    const largest = Math.max(...sizes)
    titleIndex = largest > 0 ? sizes.indexOf(largest) : 0
  }

  const title = shapes[titleIndex].lines[0]
  const bullets = shapes.flatMap(({ lines }, i) => (i === titleIndex ? lines.slice(1) : lines))

  return { title, bullets }
}

/** slideN.xml → its notesSlide path, via the slide's own rels. Numeric
 *  correspondence is NOT safe here: a deck where only some slides carry notes
 *  numbers them independently, so slide3 can own notesSlide1. */
function notesTargetFor(relsXml: string | null): string | null {
  if (!relsXml) return null
  const rels = asArray(((parser.parse(relsXml) as Node)['Relationships'] as Node | undefined)?.['Relationship'] as Node[] | undefined)
  const notes = rels.find((r) => String(r['@Type'] ?? '').endsWith('/notesSlide'))
  if (!notes) return null
  const target = String(notes['@Target'] ?? '')
  return target ? `ppt/${target.replace(/^\.\.\//, '')}` : null
}

/**
 * Slide paths in presentation order.
 *
 * Filename order is *usually* presentation order, but not reliably — reordering
 * slides in PowerPoint rewrites <p:sldIdLst>, not the file names, so an edited
 * deck imports scrambled if you trust slide7.xml to come after slide6.xml.
 * Falls back to numeric order only when the relationship graph can't be read.
 */
function orderedSlidePaths(presentationXml: string | null, relsXml: string | null, allSlidePaths: string[]): string[] {
  const numeric = [...allSlidePaths].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  if (!presentationXml || !relsXml) return numeric

  try {
    const sldIds = asArray(
      (((parser.parse(presentationXml) as Node)['p:presentation'] as Node | undefined)?.['p:sldIdLst'] as Node | undefined)?.['p:sldId'] as Node[] | undefined
    )
    const rels = asArray(((parser.parse(relsXml) as Node)['Relationships'] as Node | undefined)?.['Relationship'] as Node[] | undefined)
    const byId = new Map(rels.map((r) => [String(r['@Id'] ?? ''), `ppt/${String(r['@Target'] ?? '').replace(/^\.\.\//, '')}`]))

    const ordered = sldIds
      .map((s) => byId.get(String(s['@r:id'] ?? '')))
      .filter((path): path is string => Boolean(path) && allSlidePaths.includes(path as string))

    return ordered.length > 0 ? ordered : numeric
  } catch {
    return numeric
  }
}

function extractNotes(notesXml: string): string {
  const notesDoc = parser.parse(notesXml) as Node
  const spTree = ((notesDoc['p:notes'] as Node | undefined)?.['p:cSld'] as Node | undefined)?.['p:spTree'] as Node | undefined
  return shapeTreeLines(spTree).filter((line) => !/^\d+$/.test(line)).join('\n')
}

export async function extractPptxSlides(buffer: Buffer): Promise<ImportedSlide[]> {
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(buffer)

  const slidePaths = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n))
  if (slidePaths.length === 0) return []

  const read = async (path: string): Promise<string | null> => {
    const file = zip.file(path)
    return file ? file.async('string') : null
  }

  const ordered = orderedSlidePaths(
    await read('ppt/presentation.xml'),
    await read('ppt/_rels/presentation.xml.rels'),
    slidePaths,
  ).slice(0, MAX_SLIDE_COUNT)

  const out: ImportedSlide[] = []
  for (const path of ordered) {
    const xml = await read(path)
    if (!xml) continue

    const { title, bullets } = parseSlideXml(xml)

    const relsPath  = path.replace(/slides\/(slide\d+)\.xml$/i, 'slides/_rels/$1.xml.rels')
    const notesPath = notesTargetFor(await read(relsPath))
    const notesXml  = notesPath ? await read(notesPath) : null

    // A notes part carries more than the notes: PowerPoint also puts a slide
    // -number placeholder in it, which reads back as a bare digit. Dropping
    // numeric-only lines keeps that artefact out of the imported notes.
    const notes = notesXml ? extractNotes(notesXml) : ''

    if (!title && bullets.length === 0 && !notes) continue   // a genuinely blank slide
    out.push({ title: title || 'Без заголовка', bullets, notes })
  }

  return out
}

/**
 * Imported slides → the app's typed Slide union.
 *
 * Everything becomes `bullets` apart from the opener, because the source
 * carries no type information and guessing wrongly is worse than being plain:
 * a mis-detected `formula` slide would render an ordinary sentence as an
 * equation. The teacher can upgrade any slide with «Переписать», which is a
 * one-click, one-call operation since Phase 1.
 */
export function toTypedSlides(imported: ImportedSlide[]): Slide[] {
  return imported.map((slide, i) => {
    if (i === 0 && slide.bullets.length <= 2) {
      return {
        type: 'title',
        title: slide.title,
        notes: slide.notes,
        citations: [],
        body: { subtitle: slide.bullets[0] ?? null, lecturer: slide.bullets[1] ?? null },
      } as Slide
    }
    return {
      type: 'bullets',
      title: slide.title,
      notes: slide.notes,
      citations: [],
      body: { items: slide.bullets },
    } as Slide
  })
}

export async function importPptx(buffer: Buffer): Promise<{ slides: Slide[]; sourceSlideCount: number }> {
  try {
    const imported = await extractPptxSlides(buffer)
    return { slides: toTypedSlides(imported), sourceSlideCount: imported.length }
  } catch (err) {
    logger.warn({ message: '[pptx import] failed to parse', error: (err as Error).message })
    return { slides: [], sourceSlideCount: 0 }
  }
}
