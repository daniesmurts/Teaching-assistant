import { logger } from '../lib/logger'

/**
 * OCR via Yandex Vision — best Cyrillic accuracy, accessible inside Russia.
 * Accepts image buffers and PDF buffers (Vision handles PDF natively up to a limit).
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

// ─── Minimal response typing ──────────────────────────────────────────────────

interface YandexWord  { text: string }
interface YandexLine  { words?: YandexWord[] }
interface YandexBlock { lines?: YandexLine[] }
interface YandexPage  { blocks?: YandexBlock[] }
interface YandexVisionResponse {
  results?: { results?: { textDetection?: { pages?: YandexPage[] } }[] }[]
}
