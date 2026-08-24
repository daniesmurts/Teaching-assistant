import mammoth from 'mammoth'
import { yandexVisionOCR } from './yandexVision'
import { extractDocxTextWithFormulas } from './ommlToLatex'
import { logger } from '../lib/logger'
import type { CallContext } from './llm/types'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const CHARS_PER_TOKEN = 3.5  // Russian text ≈ 3.5 chars/token

export type ExtractionMethod = 'text_layer' | 'ocr' | 'docx'

export interface ExtractResult {
  text:       string
  method:     ExtractionMethod
  pageCount?: number
}

// ─── "Does this document actually carry text?" ────────────────────────────────
//
// Counting whitespace-split tokens is fooled by a scanned document whose
// only "text layer" is structural noise — pdf-parse's own per-page markers
// ("-- 1 of 23 --", ...), page numbers, table rules. Confirmed against a
// real fgosvo.ru document (23 scanned pages) where those markers alone
// tokenised to 115 "words", sailing past any reasonable threshold while
// carrying zero real content. Runs of 2+ Unicode letters are immune to that.
const MIN_REAL_WORDS = 50

function countRealWords(text: string): number {
  return (text.match(/\p{L}{2,}/gu) ?? []).length
}

// ─── Image-only .docx → OCR ───────────────────────────────────────────────────
//
// Teachers frequently build a "conspectus" by pasting screenshots of a
// textbook or their own notes into Word. The .docx is a perfectly valid
// document with a near-empty text layer, so every text extractor returns
// nothing and downstream treats it as "no material supplied".
//
// Only raster formats Yandex Vision can actually decode are sent; EMF/WMF
// (Word's vector formats, typically pasted charts/shapes rather than
// screenshots) are skipped rather than wasting an OCR call on something
// Vision will reject.
const OCR_IMAGE_EXTENSIONS: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', tif: 'image/tiff', tiff: 'image/tiff',
}
// A screenshot-built conspectus is typically one image per textbook page.
// The cap bounds worst-case OCR cost/latency on a pathological upload; the
// text recovered from the first N pages is still far better than nothing.
const MAX_DOCX_OCR_IMAGES = 40
const MIN_DOCX_IMAGE_BYTES = 8 * 1024   // skip icons/bullets/logos — too small to be a page scan

async function ocrDocxImages(fileBuffer: Buffer, context?: CallContext): Promise<string> {
  try {
    const JSZip = (await import('jszip')).default
    const zip = await JSZip.loadAsync(fileBuffer)

    const mediaNames = Object.keys(zip.files)
      .filter((name) => /^word\/media\/[^/]+$/i.test(name))
      .filter((name) => (zip.files[name] as { dir?: boolean }).dir !== true)
      // image1, image2, ... — numeric order is document order in practice,
      // so a truncated run still reads as the start of the document.
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

    const parts: string[] = []
    let processed = 0

    for (const name of mediaNames) {
      if (processed >= MAX_DOCX_OCR_IMAGES) break
      const ext = name.split('.').pop()?.toLowerCase() ?? ''
      const mime = OCR_IMAGE_EXTENSIONS[ext]
      if (!mime) continue

      const buf = await zip.file(name)!.async('nodebuffer')
      if (buf.length < MIN_DOCX_IMAGE_BYTES) continue

      processed++
      const text = await yandexVisionOCR(buf, mime, context)
      if (text.trim()) parts.push(text.trim())
    }

    if (processed > 0) {
      logger.info({
        message: '[docx] text layer was near-empty, OCRed embedded images instead',
        imagesFound: mediaNames.length, imagesOcred: processed, charsRecovered: parts.join('').length,
      })
    }
    // \f between images so downstream page-aware code treats each screenshot
    // as its own page, matching what yandexVisionOCR does for PDF pages.
    return parts.join('\f')
  } catch (err) {
    logger.warn({ message: '[docx] embedded-image OCR failed', error: (err as Error).message })
    return ''
  }
}

// ─── Main entry — routes by MIME type ─────────────────────────────────────────
//
// `context` is optional (TODO.md Improvement #13) — passed through to
// yandexVisionOCR so an OCR fallback gets cost-logged under the caller's
// teacher/institution. Only threaded from the teacher-facing upload paths
// (services/documents.ts, services/rpdSubmissions.ts) at time of writing;
// the institution-admin bulk-import call sites (routes/programs.ts,
// routes/adminFgos.ts, services/institutionStrategyDoc.ts) don't pass one
// yet — a known residual gap, not an oversight, left for a follow-up pass.

export async function extractText(
  fileBuffer: Buffer,
  mimeType: string,
  context?: CallContext,
): Promise<ExtractResult> {

  if (mimeType === DOCX_MIME) {
    // mammoth.extractRawText() has no concept of OOXML math (`<m:oMath>`,
    // what Word's Equation Editor writes) and silently drops it — fine for
    // the common case (no formulas), but exactly what a teacher hit
    // uploading a conspectus full of equations. Only reach for the custom
    // XML walker when it actually found formulas; otherwise defer to
    // mammoth, which is more battle-tested for everything else a real
    // Word document can contain (styles, footnotes, weird nesting) and is
    // what every other call site here still relies on unchanged.
    const withFormulas = await extractDocxTextWithFormulas(fileBuffer)
    let text: string
    if (withFormulas && withFormulas.formulaCount > 0 && withFormulas.text.trim()) {
      text = cleanText(withFormulas.text)
    } else {
      const result = await mammoth.extractRawText({ buffer: fileBuffer })
      text = cleanText(result.value)
    }

    // Teachers routinely "scan" a textbook or their handwritten notes by
    // pasting SCREENSHOTS into Word — the .docx then carries essentially no
    // real text, only pictures. Every extractor above returns ~nothing for
    // such a file, and downstream that reads as "no material", which is how
    // a presentation ended up generated from the topic string alone. Same
    // trigger and threshold as the scanned-PDF branch below: too little
    // real text → OCR the embedded images instead of returning near-empty.
    if (countRealWords(text) < MIN_REAL_WORDS) {
      const ocrText = cleanText(await ocrDocxImages(fileBuffer, context))
      if (ocrText) {
        // Keep whatever genuine text layer existed (captions, headings) and
        // append the OCR — the two are complementary, not alternatives.
        const merged = [text, ocrText].filter((s) => s.trim()).join('\n\n')
        return { text: merged, method: 'ocr' }
      }
    }

    return { text, method: 'docx' }
  }

  if (mimeType === 'application/pdf') {
    try {
      const { PDFParse } = await import('pdf-parse')
      const parser = new PDFParse({ data: new Uint8Array(fileBuffer) })
      let pageCount: number
      let text: string
      try {
        const result = await parser.getText()
        text      = result.text.trim()
        pageCount = result.total
      } finally {
        await parser.destroy()
      }

      // Very little real text → likely a scanned PDF, fall through to OCR.
      // See countRealWords() for why this doesn't count whitespace tokens.
      if (countRealWords(text) < MIN_REAL_WORDS) {
        const ocrText = await yandexVisionOCR(fileBuffer, 'application/pdf', context)
        return { text: cleanText(ocrText), method: 'ocr', pageCount }
      }

      return { text: cleanText(text), method: 'text_layer', pageCount }
    } catch {
      const ocrText = await yandexVisionOCR(fileBuffer, 'application/pdf', context)
      return { text: cleanText(ocrText), method: 'ocr' }
    }
  }

  if (mimeType.startsWith('image/')) {
    const ocrText = await yandexVisionOCR(fileBuffer, mimeType, context)
    return { text: cleanText(ocrText), method: 'ocr' }
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

// ─── Cleaning ─────────────────────────────────────────────────────────────────

export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Preserve \f (page breaks) so downstream code can cite page numbers.
    // pdf-parse emits them between pages by default; yandexVisionOCR inserts
    // them explicitly. cleanText only trims surrounding whitespace.
    .replace(/[ \t]*\f[ \t]*/g, '\f')
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+$/gm, '')
    .trim()
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}
