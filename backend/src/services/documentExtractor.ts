import mammoth from 'mammoth'
import { yandexVisionOCR } from './yandexVision'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const CHARS_PER_TOKEN = 3.5  // Russian text ≈ 3.5 chars/token

export type ExtractionMethod = 'text_layer' | 'ocr' | 'docx'

export interface ExtractResult {
  text:       string
  method:     ExtractionMethod
  pageCount?: number
}

// ─── Main entry — routes by MIME type ─────────────────────────────────────────

export async function extractText(
  fileBuffer: Buffer,
  mimeType: string
): Promise<ExtractResult> {

  if (mimeType === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer: fileBuffer })
    return { text: cleanText(result.value), method: 'docx' }
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

      // Very little text → likely a scanned PDF, fall through to OCR
      const wordCount = text.split(/\s+/).filter(Boolean).length
      if (wordCount < 50) {
        const ocrText = await yandexVisionOCR(fileBuffer, 'application/pdf')
        return { text: cleanText(ocrText), method: 'ocr', pageCount }
      }

      return { text: cleanText(text), method: 'text_layer', pageCount }
    } catch {
      const ocrText = await yandexVisionOCR(fileBuffer, 'application/pdf')
      return { text: cleanText(ocrText), method: 'ocr' }
    }
  }

  if (mimeType.startsWith('image/')) {
    const ocrText = await yandexVisionOCR(fileBuffer, mimeType)
    return { text: cleanText(ocrText), method: 'ocr' }
  }

  throw new Error(`Unsupported file type: ${mimeType}`)
}

// ─── Cleaning ─────────────────────────────────────────────────────────────────

export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\f/g, '\n')        // form feeds (page breaks)
    .replace(/\t/g, ' ')
    .replace(/[ ]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[^\S\n]+$/gm, '')  // trailing spaces per line
    .trim()
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN)
}

// ─── Assignment token budget — smart truncation keeps intro+body+conclusion ───

const ASSIGNMENT_TOKEN_LIMIT = 8000

export function prepareAssignmentText(text: string): {
  text: string
  wasTruncated: boolean
  originalWordCount: number
} {
  const words = text.split(/\s+/).filter(Boolean)
  const originalWordCount = words.length

  if (estimateTokens(text) <= ASSIGNMENT_TOKEN_LIMIT) {
    return { text, wasTruncated: false, originalWordCount }
  }

  const targetWords  = Math.floor((ASSIGNMENT_TOKEN_LIMIT * CHARS_PER_TOKEN) / 5)
  const introWords   = Math.floor(targetWords * 0.15)
  const bodyWords    = Math.floor(targetWords * 0.65)
  const closingWords = Math.floor(targetWords * 0.20)

  const bodyStart = Math.floor(words.length * 0.15)
  const intro   = words.slice(0, introWords).join(' ')
  const body    = words.slice(bodyStart, bodyStart + bodyWords).join(' ')
  const closing = words.slice(-closingWords).join(' ')

  const truncated =
    `${intro}\n\n[...]\n\n${body}\n\n[...]\n\n${closing}` +
    `\n\n[Документ сокращён для обработки. Исходный объём: ${originalWordCount} слов.]`

  return { text: truncated, wasTruncated: true, originalWordCount }
}
