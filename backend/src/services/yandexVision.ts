import { logger } from '../lib/logger'

// Yandex Vision v1 batchAnalyze silently caps a PDF at 8 pages per call — a
// 20-page scanned учебный план loses everything after page 8. When pdf-lib is
// available at runtime we split the PDF into 8-page chunks and OCR each. If
// pdf-lib isn't installed (npm install pdf-lib) the code degrades to the
// single-call behavior — identical to before, no regression, just a warning.
const PAGES_PER_OCR_CALL = 8

/**
 * OCR via Yandex Vision — best Cyrillic accuracy, accessible inside Russia.
 * Accepts image buffers and PDF buffers. For multi-page PDFs > 8 pages, splits
 * into 8-page chunks so nothing is silently truncated (requires pdf-lib).
 */
export async function yandexVisionOCR(
  fileBuffer: Buffer,
  mimeType = 'image/jpeg'
): Promise<string> {
  const apiKey   = process.env.YANDEX_VISION_API_KEY
  const folderId = process.env.YANDEX_FOLDER_ID

  if (!apiKey || !folderId) {
    logger.warn({ message: 'Yandex Vision not configured — OCR skipped', mimeType })
    return ''
  }

  // Non-PDFs (images) always go in a single call.
  if (mimeType !== 'application/pdf') {
    return ocrOneChunk(fileBuffer, apiKey, folderId)
  }

  // Split PDFs > 8 pages so nothing after page 8 is silently lost.
  const chunks = await splitPdfIntoChunks(fileBuffer, PAGES_PER_OCR_CALL)
  if (chunks.length <= 1) {
    return ocrOneChunk(fileBuffer, apiKey, folderId)
  }
  logger.info({ message: 'PDF OCR: splitting into chunks', chunks: chunks.length })

  // Sequential (not parallel) — Vision has per-key rate limits and OCR of a
  // large scanned plan is already slow; avoiding a burst keeps the request
  // predictable and preserves reading order.
  const out: string[] = []
  for (const chunk of chunks) {
    out.push(await ocrOneChunk(chunk, apiKey, folderId))
  }
  // Chunks are already separated by their own \f page-breaks; join with \f
  // between chunks to preserve the same downstream «[стр. N]» convention.
  return out.join('\f')
}

async function ocrOneChunk(
  fileBuffer: Buffer, apiKey: string, folderId: string,
): Promise<string> {
  const base64Content = fileBuffer.toString('base64')

  const response = await fetch(
    'https://vision.api.cloud.yandex.net/vision/v1/batchAnalyze',
    {
      method: 'POST',
      headers: {
        Authorization:  `Api-Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        folderId,
        analyze_specs: [{
          content: base64Content,
          features: [{
            type: 'TEXT_DETECTION',
            text_detection_config: { language_codes: ['ru', 'en'] },
          }],
        }],
      }),
    }
  )

  if (!response.ok) {
    throw new Error(`Yandex Vision API error: ${response.status}`)
  }

  const data  = await response.json() as YandexVisionResponse
  const pages = data.results?.[0]?.results?.[0]?.textDetection?.pages ?? []

  // Reconstruct reading order: blocks → lines → words.
  // Page boundaries are kept as form-feed (\f) — downstream code converts that
  // into "[стр. N]" markers in the grading prompt so the model can cite pages.
  return pages
    .map((page) =>
      (page.blocks ?? [])
        .flatMap((block) => block.lines ?? [])
        .map((line) => (line.words ?? []).map((w) => w.text).join(' '))
        .join('\n')
    )
    .join('\f')
}

// Split a PDF Buffer into N-page chunks using pdf-lib. Dynamic import so the
// service still runs (with single-call OCR — legacy behavior) if pdf-lib isn't
// installed. Returns [original] when splitting can't help (single page,
// pdf-lib missing, or corrupt PDF).
// Structural type for the subset of pdf-lib we use — lets tsc succeed even
// before the dependency is installed (dynamic import at runtime is what
// actually loads it).
interface PdfLibPageProxy { /* opaque */ }
interface PdfLibDoc {
  getPageCount(): number
  copyPages(src: PdfLibDoc, indices: number[]): Promise<PdfLibPageProxy[]>
  addPage(p: PdfLibPageProxy): void
  save(): Promise<Uint8Array>
}
interface PdfLibShape {
  PDFDocument: {
    load(bytes: Buffer, opts?: { ignoreEncryption?: boolean }): Promise<PdfLibDoc>
    create(): Promise<PdfLibDoc>
  }
}

async function splitPdfIntoChunks(fileBuffer: Buffer, pagesPerChunk: number): Promise<Buffer[]> {
  let pdfLib: PdfLibShape
  try {
    // Dynamic import — pdf-lib may or may not be present depending on how the
    // env was provisioned. Cast through unknown so the code compiles whether
    // or not `pdf-lib` has type declarations resolvable at build time.
    pdfLib = (await import('pdf-lib' as string)) as unknown as PdfLibShape
  } catch {
    logger.warn({ message: 'pdf-lib not installed — PDF OCR limited to first ~8 pages. Run: npm install pdf-lib' })
    return [fileBuffer]
  }
  try {
    const { PDFDocument } = pdfLib
    const src = await PDFDocument.load(fileBuffer, { ignoreEncryption: true })
    const total = src.getPageCount()
    if (total <= pagesPerChunk) return [fileBuffer]
    const chunks: Buffer[] = []
    for (let start = 0; start < total; start += pagesPerChunk) {
      const end = Math.min(start + pagesPerChunk, total)
      const out = await PDFDocument.create()
      const copied = await out.copyPages(src, range(start, end))
      copied.forEach((p: PdfLibPageProxy) => out.addPage(p))
      const bytes = await out.save()
      chunks.push(Buffer.from(bytes))
    }
    return chunks
  } catch (err) {
    logger.warn({ message: 'PDF split failed — falling back to single-call OCR', error: (err as Error).message })
    return [fileBuffer]
  }
}

function range(start: number, end: number): number[] {
  const out: number[] = []
  for (let i = start; i < end; i++) out.push(i)
  return out
}

// ─── Minimal response typing ──────────────────────────────────────────────────

interface YandexWord  { text: string }
interface YandexLine  { words?: YandexWord[] }
interface YandexBlock { lines?: YandexLine[] }
interface YandexPage  { blocks?: YandexBlock[] }
interface YandexVisionResponse {
  results?: { results?: { textDetection?: { pages?: YandexPage[] } }[] }[]
}
