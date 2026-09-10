// Handwriting OCR probe — Yandex Vision vs DeepSeek vision, side by side.
//
// Why this exists: TODO.md "### AP" Phase 3 (печатный бланк + OCR) was demoted
// out of Phase 0 largely because Cyrillic **handwriting** is the hard part.
// That judgement was made against `yandexVisionOCR`, whose Yandex product is
// "Распознавание печатного текста" — printed text; handwriting is a separate
// Yandex product we don't call (see planLimits.ts's Yandex pricing comment).
// DeepSeek's FLASH model became natively multimodal on 2026-09-10, which is a
// genuinely different approach: it reads the sheet as a whole rather than
// emitting a text layer for something else to parse.
//
// Whether that is actually BETTER on Russian handwriting is an empirical
// question this repo cannot answer from documentation — DeepSeek's vision
// guide makes no handwriting or Cyrillic claim either way. So: run this
// against real photographed sheets before believing anything about Phase 3.
//
// Usage:
//   npm run probe:handwriting -- <image-or-pdf> [more files...]
//
// Needs real YANDEX_VISION_API_KEY / YANDEX_FOLDER_ID / DEEPSEEK_API_KEY in
// ../.env. Costs a few kopecks per sheet. Writes nothing and touches no
// database — it prints both transcripts and leaves the judgement to you.

import { readFile } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import { yandexVisionOCR, rasterizePdfPages } from '../src/services/yandexVision'
import { transcribeImages } from '../src/services/llm/registry'

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.pdf': 'application/pdf',
}

function countRealWords(text: string): number {
  return (text.match(/\p{L}{2,}/gu) ?? []).length
}

function section(title: string, body: string): void {
  console.log(`\n  ── ${title} ${'─'.repeat(Math.max(0, 60 - title.length))}`)
  console.log(body.trim() ? body.trim().split('\n').map((l) => `  │ ${l}`).join('\n') : '  │ (пусто)')
}

async function probe(path: string): Promise<void> {
  const ext  = extname(path).toLowerCase()
  const mime = MIME_BY_EXT[ext]
  if (!mime) throw new Error(`Unsupported extension ${ext} — expected one of ${Object.keys(MIME_BY_EXT).join(', ')}`)

  const buffer = await readFile(path)
  console.log(`\n${'═'.repeat(70)}\n  ${basename(path)}  (${(buffer.length / 1024).toFixed(0)} KB)\n${'═'.repeat(70)}`)

  const yandexStart = Date.now()
  const yandexText  = await yandexVisionOCR(buffer, mime)
  const yandexMs    = Date.now() - yandexStart

  // Same shape documentExtractor.ts's ocrWithSecondOpinion builds, so the
  // probe measures the path that actually ships, not an idealised one.
  const images = mime === 'application/pdf'
    ? ((await rasterizePdfPages(buffer)) ?? []).slice(0, 12).map((b) => ({ buffer: b, mime: 'image/png' }))
    : [{ buffer, mime }]

  if (images.length === 0) {
    console.log('  ! PDF could not be rasterized — skipping the vision half.')
    section(`Yandex Vision (${yandexMs} ms, ${countRealWords(yandexText)} слов)`, yandexText)
    return
  }

  const visionStart = Date.now()
  const visionText  = await transcribeImages(images)
  const visionMs    = Date.now() - visionStart

  section(`Yandex Vision — ${countRealWords(yandexText)} слов, ${yandexMs} ms`, yandexText)
  section(
    visionText === null
      ? 'DeepSeek vision — НЕДОСТУПНА (выключена или нет ключа)'
      : `DeepSeek vision — ${countRealWords(visionText)} слов, ${visionMs} ms, ${images.length} стр.`,
    visionText ?? '',
  )

  console.log(
    '\n  Судить по точности, а не по объёму: модель может дописать правдоподобный\n' +
    '  текст там, где его нет. Сверьте оба результата с оригиналом вручную.',
  )
}

async function main(): Promise<void> {
  const files = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  if (files.length === 0) {
    console.error('Usage: npm run probe:handwriting -- <image-or-pdf> [more files...]')
    process.exit(1)
  }
  for (const file of files) {
    try {
      await probe(file)
    } catch (err) {
      console.error(`\n  ! ${basename(file)}: ${(err as Error).message}`)
    }
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
