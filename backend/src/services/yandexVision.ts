import { execFile } from 'child_process'
import { promisify } from 'util'
import { mkdtemp, writeFile, readFile, readdir, rm } from 'fs/promises'
import { existsSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { logger } from '../lib/logger'
import { createUsageLog } from '../db/queries/usageLog'
import { calculateYandexVisionCostRub } from '../config/planLimits'
import { getUsdRubRate, rubToUsd } from './fxRate'
import type { CallContext } from './llm/types'

const execFileAsync = promisify(execFile)

/**
 * OCR via Yandex Vision — best Cyrillic accuracy, accessible inside Russia.
 * Accepts image buffers and PDF buffers. PDFs are rasterized to one PNG per
 * page before sending, for two reasons confirmed against real fgosvo.ru
 * documents:
 *   1. Yandex Vision's own PDF ingestion can't decode every embedded image
 *      codec — a CCITT Group 4 scan (the common compression for
 *      scanned government documents) fails outright with "Can't decode
 *      Image: image: unknown format", even though the PDF itself is
 *      perfectly valid and pdf-lib/pdf-parse read it fine. A plain PNG
 *      sidesteps codec support entirely.
 *   2. batchAnalyze also silently caps a raw PDF at 8 pages per call — a
 *      20+ page scanned document loses everything after page 8. Rasterizing
 *      per-page removes this cap too (one image per call, not one PDF).
 */
// `context` is optional (TODO.md Improvement #13) — best-effort usage
// logging, one row per document covering the total page count, not one row
// per Vision call. Callers that don't pass it (a handful of institution
// bulk-import paths, deliberately left as a known residual gap — see
// TODO.md) simply stay uninstrumented, same as every other `if (context)`
// fire-and-forget site in this codebase.
export async function yandexVisionOCR(
  fileBuffer: Buffer,
  mimeType = 'image/jpeg',
  context?: CallContext,
): Promise<string> {
  const apiKey   = process.env.YANDEX_VISION_API_KEY
  const folderId = process.env.YANDEX_FOLDER_ID

  if (!apiKey || !folderId) {
    logger.warn({ message: 'Yandex Vision not configured — OCR skipped', mimeType })
    return ''
  }

  const start = Date.now()
  try {
    const result = await runOcr(fileBuffer, mimeType, apiKey, folderId)
    // Fire-and-forget, including the FX lookup inside logVisionUsage — must
    // never add latency to the OCR result itself (same rule as
    // createUsageLog's own doc comment).
    if (result.pageCount > 0) logVisionUsage(context, result.pageCount, Date.now() - start, true)
    return result.text
  } catch (err) {
    // pageCount 0 on failure — no pages were successfully billed, but the
    // row still records that a call was attempted and failed.
    logVisionUsage(context, 0, Date.now() - start, false)
    throw err
  }
}

async function runOcr(
  fileBuffer: Buffer, mimeType: string, apiKey: string, folderId: string,
): Promise<{ text: string; pageCount: number }> {
  // Non-PDFs (images) always go in a single call.
  if (mimeType !== 'application/pdf') {
    return { text: await ocrOneChunk(fileBuffer, apiKey, folderId), pageCount: 1 }
  }

  const pages = await rasterizePdfPages(fileBuffer)
  if (pages === null) {
    // Rasterizer unavailable/failed — degrade to the legacy whole-PDF call.
    // Works for a PDF Vision can decode natively; still fails for a
    // CCITT-encoded scan, but that's the same behavior as before this fix.
    return { text: await ocrOneChunk(fileBuffer, apiKey, folderId), pageCount: 1 }
  }
  if (pages.length === 0) return { text: '', pageCount: 0 }
  if (pages.length === 1) return { text: await ocrOneChunk(pages[0], apiKey, folderId), pageCount: 1 }

  logger.info({ message: 'PDF OCR: rasterized to page images', pages: pages.length })

  // Sequential (not parallel) — Vision has per-key rate limits and OCR of a
  // large scanned document is already slow; avoiding a burst keeps the
  // request predictable and preserves reading order.
  const out: string[] = []
  for (const page of pages) {
    out.push(await ocrOneChunk(page, apiKey, folderId))
  }
  // Each page is OCR'd independently; join with \f to preserve the same
  // downstream «[стр. N]» convention as a native multi-page result.
  return { text: out.join('\f'), pageCount: pages.length }
}

async function logVisionUsage(
  context: CallContext | undefined, pageCount: number, durationMs: number, success: boolean,
): Promise<void> {
  if (!context) return
  try {
    const costRub = calculateYandexVisionCostRub(pageCount)
    const { rate } = await getUsdRubRate()
    await createUsageLog({
      ...context,
      model:        'yandex:vision-ocr',
      inputTokens:  pageCount,   // pages, not tokens — Vision bills per page, not per token
      outputTokens: 0,
      costUsd:      rubToUsd(costRub, rate),
      costNative:   costRub,
      currency:     'RUB',
      fxRateUsed:   rate,
      durationMs,
      success,
    })
  } catch (e) {
    logger.warn({ message: 'Failed to write Vision usage log', error: (e as Error).message })
  }
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

// Rasterize every page of a PDF to a PNG buffer via `pdf-to-img` (wraps
// pdfjs-dist — pure JS, no system binary like poppler required, so this
// works on any deploy target without extra provisioning). Dynamic import so
// the service still runs (degraded to the legacy whole-PDF call — see
// yandexVisionOCR) if the package isn't installed. Returns null (not []) so
// the caller can tell "rasterizer unavailable/failed" apart from "genuinely
// zero pages" and choose the right fallback.
// Structural type for the subset of pdf-to-img we use — lets tsc succeed
// even before the dependency is installed (dynamic import at runtime is
// what actually loads it).
interface PdfToImgShape {
  pdf(dataUrl: string, opts?: { scale?: number }): Promise<AsyncIterable<Buffer>>
}

// Exported for Feature AN Phase 2 (documentExtractor.ts's extractPdfFigures)
// — reuses this exact rasterization path (and its child-process corruption
// workaround, see the comment below) to pull page images for the figure
// library, not just for OCR.
export async function rasterizePdfPages(fileBuffer: Buffer): Promise<Buffer[] | null> {
  // Run in a fresh child process — proven necessary, not just defensive.
  // Reproduced live in production (2026-07-23): if pdf-parse's getText() has
  // run anywhere earlier in this process (documentExtractor.ts always tries
  // it first), pdf-to-img's pdfjs-dist worker resolution gets permanently
  // corrupted for the rest of the process's lifetime — "API version X does
  // not match Worker version Y" on every subsequent call, even though both
  // packages resolve to the same correct on-disk version. A fresh process
  // never ran pdf-parse, so it never inherits the corruption. See
  // rasterizeWorker.ts for the full writeup.
  //
  // Dev-mode fallback: rasterizeWorker.js only exists once compiled (`tsc`
  // build, same directory as this file's own compiled output) — under `tsx`
  // in local dev there's no sibling .js to spawn, and this exact corruption
  // was never reproduced locally, so we just call pdf-to-img in-process.
  const compiledWorkerPath = path.join(__dirname, 'rasterizeWorker.js')
  if (existsSync(compiledWorkerPath)) {
    return rasterizeViaChildProcess(fileBuffer, compiledWorkerPath)
  }
  return rasterizeInProcess(fileBuffer)
}

async function rasterizeViaChildProcess(fileBuffer: Buffer, workerPath: string): Promise<Buffer[] | null> {
  const dir = await mkdtemp(path.join(tmpdir(), 'rasterize-'))
  try {
    const pdfPath = path.join(dir, 'input.pdf')
    await writeFile(pdfPath, fileBuffer)
    await execFileAsync(process.execPath, [workerPath, pdfPath, dir], { timeout: 120_000 })

    const files = (await readdir(dir)).filter((f) => f.startsWith('page-')).sort()
    return Promise.all(files.map((f) => readFile(path.join(dir, f))))
  } catch (err) {
    const message = err instanceof Error && 'stderr' in err
      ? String((err as { stderr?: unknown }).stderr) || err.message
      : (err as Error).message
    logger.warn({ message: 'PDF rasterization failed — falling back to whole-PDF OCR call', error: message })
    return null
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => null)
  }
}

async function rasterizeInProcess(fileBuffer: Buffer): Promise<Buffer[] | null> {
  let pdfToImg: PdfToImgShape
  try {
    // Cast through unknown so the code compiles whether or not `pdf-to-img`
    // has type declarations resolvable at build time.
    pdfToImg = (await import('pdf-to-img' as string)) as unknown as PdfToImgShape
  } catch {
    logger.warn({ message: 'pdf-to-img not installed — scanned-PDF OCR may fail on some documents (e.g. CCITT-encoded scans). Run: npm install pdf-to-img' })
    return null
  }
  try {
    // pdf-to-img takes a file path or a data URL, not a raw Buffer.
    const dataUrl = `data:application/pdf;base64,${fileBuffer.toString('base64')}`
    const doc = await pdfToImg.pdf(dataUrl, { scale: 2 })
    const pages: Buffer[] = []
    for await (const page of doc) pages.push(page)
    return pages
  } catch (err) {
    logger.warn({ message: 'PDF rasterization failed — falling back to whole-PDF OCR call', error: (err as Error).message })
    return null
  }
}

// ─── Minimal response typing ──────────────────────────────────────────────────

interface YandexWord  { text: string }
interface YandexLine  { words?: YandexWord[] }
interface YandexBlock { lines?: YandexLine[] }
interface YandexPage  { blocks?: YandexBlock[] }
interface YandexVisionResponse {
  results?: { results?: { textDetection?: { pages?: YandexPage[] } }[] }[]
}
