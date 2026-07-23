// Standalone entry point — spawned as a fresh child process by
// rasterizePdfPages() (services/yandexVision.ts).
//
// Why a child process: reproduced live on the production VM (2026-07-23) —
// calling pdf-parse's getText() anywhere earlier in the SAME Node process
// permanently corrupts pdf-to-img's pdfjs-dist worker resolution for the
// rest of that process's lifetime, throwing "API version X does not match
// Worker version Y" on every subsequent rasterization attempt, even though
// both packages independently resolve to the same correct pdfjs-dist
// version on disk (confirmed via `npm ls`) — pdf-parse's CJS build vendors
// its own inlined pdfjs-dist copy whose Node "fake worker" registration
// collides with the real top-level instance pdf-to-img uses. Setting
// `GlobalWorkerOptions.workerSrc` explicitly to an absolute path does NOT
// fix it (verified). Since documentExtractor.ts always runs pdf-parse's
// text-layer extraction before falling back to OCR/rasterization, this hit
// on every scanned-PDF OCR attempt in production, 100% of the time. A fresh
// child process never ran pdf-parse, so it never gets corrupted — verified
// live on the VM as the fix.
//
// argv: [nodePath, thisScript, pdfPath, outDir] — rasterizes every page to
// outDir/page-0000.png, page-0001.png, ... and prints the page count to
// stdout. Non-zero exit + stderr message on any failure.

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

async function main(): Promise<void> {
  const [, , pdfPath, outDir] = process.argv
  if (!pdfPath || !outDir) {
    console.error('usage: rasterizeWorker.js <pdfPath> <outDir>')
    process.exit(1)
  }

  const { pdf } = (await import('pdf-to-img' as string)) as unknown as {
    pdf(dataUrl: string, opts?: { scale?: number }): Promise<AsyncIterable<Buffer>>
  }

  const buffer = readFileSync(pdfPath)
  const dataUrl = `data:application/pdf;base64,${buffer.toString('base64')}`
  const doc = await pdf(dataUrl, { scale: 2 })

  let count = 0
  for await (const page of doc) {
    writeFileSync(path.join(outDir, `page-${String(count).padStart(4, '0')}.png`), page)
    count++
  }
  console.log(count)
}

main().catch((err: Error) => {
  console.error(err.message)
  process.exit(1)
})
