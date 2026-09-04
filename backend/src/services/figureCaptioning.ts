import { chatJSON, embed, captionImage } from './llm/registry'
import { sanitiseForPrompt } from '../lib/promptSanitiser'
import { logger } from '../lib/logger'
import type { CallContext } from './llm/types'

// Feature AN Phase 2 (TODO.md "### AN") — captions a figure two ways,
// preferring the stronger one when it's available:
//
//   1. Vision (services/llm/registry.ts's captionImage, DeepSeek's
//      experimental deepseek-v4-flash-vision-exp model) — real image
//      understanding, not just whatever text happens to be printed on the
//      sheet. Gated behind DEEPSEEK_VISION_ENABLED (default off — see
//      deepseek.ts's isVisionEnabled doc comment); never throws, so a
//      disabled/unavailable/failed vision call is indistinguishable from
//      "not attempted" to this function.
//   2. OCR + text chatJSON fallback — pulls whatever text is printed on the
//      drawing itself (a чертёж's title block is designed to carry exactly
//      this: ГОСТ/номер, наименование, обозначения) and turns that plus
//      surrounding document context into a short structured caption via a
//      plain text call. Weaker (depends on legible on-sheet text) but has
//      no dependency on the experimental vision endpoint, so it's what
//      every deployment gets by default and what every other deployment
//      falls back to.

export interface FigureCaption {
  caption: string
  labels:  string[]
}

const MAX_OCR_CHARS     = 800
const MAX_CONTEXT_CHARS = 400

function buildEmptyCaption(): FigureCaption {
  return { caption: '', labels: [] }
}

/**
 * ocrText: what yandexVisionOCR read off the image itself.
 * surroundingText: the chunk of document prose immediately around the
 * figure (extraction order) — gives the model context an isolated title
 * block alone wouldn't have (e.g. "Рис. 3 — вал редуктора" mentioned in the
 * paragraph before the image).
 * image: the figure's own buffer/mime — when supplied AND vision is
 * enabled, tried first; omit to skip straight to the OCR+text path (e.g. a
 * caller that already knows vision is pointless, or a unit test).
 */
export async function captionFigure(
  ocrText: string,
  surroundingText: string,
  context?: CallContext,
  image?: { buffer: Buffer; mime: string },
): Promise<FigureCaption> {
  const cleanOcr = sanitiseForPrompt(ocrText.slice(0, MAX_OCR_CHARS))
  const cleanContext = sanitiseForPrompt(surroundingText.slice(0, MAX_CONTEXT_CHARS))

  if (image) {
    const visionResult = await captionFigureWithVision(image.buffer, image.mime, cleanContext, context)
    if (visionResult) return visionResult
    // Falls through to the OCR+text path below — vision disabled,
    // unavailable, or genuinely found nothing captionable.
  }

  if (!cleanOcr.trim() && !cleanContext.trim()) return buildEmptyCaption()

  try {
    const result = await chatJSON<FigureCaption>(
      [
        {
          role: 'system',
          content:
            'Вы составляете краткую подпись на русском языке для чертежа/схемы из учебного материала. ' +
            'Используйте только текст, который реально присутствует ниже — не придумывайте детали. ' +
            'Если текста недостаточно для содержательной подписи, верните пустую строку в поле caption. ' +
            'Ответьте JSON вида {"caption": "...", "labels": ["..."]} — labels: короткие обозначения/номера, встреченные в тексте (можно пустой массив).',
        },
        {
          role: 'user',
          content:
            `Текст, распознанный на изображении:\n${cleanOcr || '(нет)'}\n\n` +
            `Окружающий текст документа:\n${cleanContext || '(нет)'}`,
        },
      ],
      'caption',
      { context, temperature: 0.1, maxTokens: 200 }
    )
    return {
      caption: (result.caption ?? '').trim(),
      labels:  Array.isArray(result.labels) ? result.labels.filter((l) => typeof l === 'string') : [],
    }
  } catch (err) {
    logger.warn({ message: '[figure caption] chatJSON failed', error: (err as Error).message })
    return buildEmptyCaption()
  }
}

async function captionFigureWithVision(
  imageBuffer: Buffer,
  mimeType: string,
  surroundingText: string,
  context?: CallContext,
): Promise<FigureCaption | null> {
  const promptText =
    'Опишите кратко на русском языке, что изображено на этом чертеже/схеме из учебного материала. ' +
    'Не выдумывайте детали, которых не видно на изображении — если само изображение неинформативно, верните пустую строку в поле caption. ' +
    (surroundingText.trim() ? `Контекст документа: ${surroundingText}\n\n` : '') +
    'Ответьте JSON вида {"caption": "...", "labels": ["..."]} — labels: короткие обозначения/номера, видимые на изображении (можно пустой массив).'

  const result = await captionImage(imageBuffer, mimeType, promptText, context)
  if (!result || !result.caption) return null
  return { caption: result.caption, labels: result.labels }
}

/** Embeds the caption for retrieval — falls back to raw OCR text when the
 *  caption came back empty, so a figure with clear on-sheet text but no
 *  usable LLM caption is still retrievable. */
export async function embedFigureCaption(caption: FigureCaption, ocrText: string, context?: CallContext): Promise<number[] | null> {
  const text = (caption.caption || ocrText).trim()
  if (!text) return null
  try {
    return await embed(text, context)
  } catch (err) {
    logger.warn({ message: '[figure caption] embed failed', error: (err as Error).message })
    return null
  }
}
