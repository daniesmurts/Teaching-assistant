import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanText, estimateTokens } from './documentExtractor'

// Scanned-PDF OCR fallback: mocks pdf-parse's `PDFParse` class shape
// (`.getText()` → `{text, total}`, `.destroy()`) and yandexVisionOCR, so the
// dynamic `import('pdf-parse')` inside extractText() resolves to this stub.
// vi.hoisted is required (not plain top-level consts) since vi.mock factories
// are hoisted above imports and can't close over ordinary module-scope vars.
const { getTextMock, destroyMock, yandexVisionOCRMock } = vi.hoisted(() => ({
  getTextMock: vi.fn(), destroyMock: vi.fn(), yandexVisionOCRMock: vi.fn(),
}))
vi.mock('pdf-parse', () => ({
  // A regular function, not an arrow function — `new PDFParse(...)` needs a
  // real constructor; an arrow-function implementation throws "is not a
  // constructor" (silently swallowed by extractText's own try/catch, which
  // then falls through to OCR — a confusing failure mode to debug blind).
  PDFParse: vi.fn().mockImplementation(function PDFParseMock() {
    return { getText: getTextMock, destroy: destroyMock }
  }),
}))
vi.mock('./yandexVision', () => ({ yandexVisionOCR: yandexVisionOCRMock }))

describe('cleanText', () => {
  it('normalizes Windows line endings', () => {
    expect(cleanText('one\r\ntwo\r\nthree')).toBe('one\ntwo\nthree')
  })

  it('preserves form-feed page breaks (so chunker can derive page ranges)', () => {
    const out = cleanText('page one\fpage two\fpage three')
    expect(out.includes('\f')).toBe(true)
    expect(out.split('\f').length).toBe(3)
  })

  it('trims whitespace around form-feeds to a single \\f', () => {
    expect(cleanText('a   \f   b')).toBe('a\fb')
    expect(cleanText('a\t\f\tb')).toBe('a\fb')
  })

  it('replaces tabs with single spaces', () => {
    expect(cleanText('cell\tnext\tlast')).toBe('cell next last')
  })

  it('collapses runs of spaces but keeps newlines', () => {
    expect(cleanText('hello     world')).toBe('hello world')
    expect(cleanText('line1\nline2')).toBe('line1\nline2')
  })

  it('caps consecutive blank lines at two', () => {
    expect(cleanText('para1\n\n\n\n\npara2')).toBe('para1\n\npara2')
  })

  it('strips trailing whitespace per line', () => {
    expect(cleanText('line   \nother')).toBe('line\nother')
  })

  it('trims the entire string', () => {
    expect(cleanText('  \n\n  text  \n\n  ')).toBe('text')
  })
})

describe('extractText — scanned-PDF OCR fallback', () => {
  // Call counts (not implementations) accumulate across tests without this —
  // e.g. the previous test's OCR call would still show up in this test's
  // `not.toHaveBeenCalled()` assertion.
  beforeEach(() => { getTextMock.mockClear(); destroyMock.mockClear(); yandexVisionOCRMock.mockClear() })

  it('falls back to OCR when pdf-parse only returns per-page markers (no real text)', async () => {
    // A real fgosvo.ru document: a scanned PDF whose only "text layer" is
    // pdf-parse's own page-boundary markers — 23 pages, zero real content.
    // Naively token-splitting this yields 115 "words" (well past a 50-word
    // threshold), which used to fool the OCR trigger entirely.
    const markerOnlyText = Array.from({ length: 23 }, (_, i) => `-- ${i + 1} of 23 --`).join('\n\n')
    getTextMock.mockResolvedValueOnce({ text: markerOnlyText, total: 23 })
    yandexVisionOCRMock.mockResolvedValueOnce('Реальный текст со скана, распознанный OCR.')

    const { extractText } = await import('./documentExtractor')
    const result = await extractText(Buffer.from('stub pdf bytes'), 'application/pdf')

    expect(result.method).toBe('ocr')
    expect(result.text).toBe('Реальный текст со скана, распознанный OCR.')
    expect(yandexVisionOCRMock).toHaveBeenCalledOnce()
  })

  it('does not OCR a PDF with a genuine text layer', async () => {
    const realParagraph = 'Настоящий текст документа с достаточным количеством содержательных слов для прохождения порога в пятьдесят слов подряд без обращения к оптическому распознаванию символов. '
    getTextMock.mockResolvedValueOnce({ text: realParagraph.repeat(3), total: 1 })

    const { extractText } = await import('./documentExtractor')
    const result = await extractText(Buffer.from('stub pdf bytes'), 'application/pdf')

    expect(result.method).toBe('text_layer')
    expect(yandexVisionOCRMock).not.toHaveBeenCalled()
  })
})

describe('extractText — image-only .docx OCR fallback', () => {
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

  beforeEach(() => { yandexVisionOCRMock.mockClear() })

  // Builds a .docx whose body is `paragraphs`, optionally carrying files
  // under word/media — the shape Word produces when a teacher pastes
  // screenshots of a textbook instead of typing the text out.
  async function buildDocx(paragraphs: string[], media: Record<string, Buffer> = {}): Promise<Buffer> {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    const body = paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join('')
    zip.file('word/document.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
      `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
      `<w:body>${body}</w:body></w:document>`)
    for (const [name, buf] of Object.entries(media)) zip.file(`word/media/${name}`, buf)
    return zip.generateAsync({ type: 'nodebuffer' })
  }

  // Large enough to clear MIN_DOCX_IMAGE_BYTES (icons/bullets are skipped).
  const pageScan = (seed: number) => Buffer.alloc(20 * 1024, seed)

  it('OCRs embedded images when the text layer is only a caption or two', async () => {
    yandexVisionOCRMock
      .mockResolvedValueOnce('Глава 1. Основные понятия теории турбулентности.')
      .mockResolvedValueOnce('Глава 2. Осреднение по Рейнольдсу.')

    const buffer = await buildDocx(
      ['Лекция 3'],
      { 'image1.png': pageScan(1), 'image2.png': pageScan(2) },
    )

    const { extractText } = await import('./documentExtractor')
    const result = await extractText(buffer, DOCX_MIME)

    expect(result.method).toBe('ocr')
    expect(yandexVisionOCRMock).toHaveBeenCalledTimes(2)
    // The thin real text layer is kept, not discarded in favour of the OCR.
    expect(result.text).toContain('Лекция 3')
    expect(result.text).toContain('Основные понятия теории турбулентности')
    expect(result.text).toContain('Осреднение по Рейнольдсу')
  })

  it('does not OCR a .docx that already has a real text layer', async () => {
    // Must clear MIN_REAL_WORDS (50 runs of 2+ letters) — this paragraph is
    // ~21 such words, so four of them put the document safely over.
    const realParagraph = 'Настоящий текст конспекта с достаточным количеством содержательных слов для прохождения порога в пятьдесят слов подряд без обращения к распознаванию.'
    const buffer = await buildDocx(Array(4).fill(realParagraph), { 'image1.png': pageScan(1) })

    const { extractText } = await import('./documentExtractor')
    const result = await extractText(buffer, DOCX_MIME)

    expect(result.method).toBe('docx')
    expect(yandexVisionOCRMock).not.toHaveBeenCalled()
  })

  it('skips tiny images (icons, bullets, logos) rather than spending OCR calls on them', async () => {
    const buffer = await buildDocx(['Лекция 3'], { 'image1.png': Buffer.alloc(200, 7) })

    const { extractText } = await import('./documentExtractor')
    const result = await extractText(buffer, DOCX_MIME)

    expect(yandexVisionOCRMock).not.toHaveBeenCalled()
    expect(result.method).toBe('docx')
  })

  it('skips vector formats Yandex Vision cannot decode (EMF/WMF)', async () => {
    const buffer = await buildDocx(['Лекция 3'], { 'image1.emf': pageScan(1), 'image2.wmf': pageScan(2) })

    const { extractText } = await import('./documentExtractor')
    await extractText(buffer, DOCX_MIME)

    expect(yandexVisionOCRMock).not.toHaveBeenCalled()
  })

  it('still returns the plain text layer when OCR yields nothing (Vision unconfigured)', async () => {
    yandexVisionOCRMock.mockResolvedValue('')
    const buffer = await buildDocx(['Лекция 3'], { 'image1.png': pageScan(1) })

    const { extractText } = await import('./documentExtractor')
    const result = await extractText(buffer, DOCX_MIME)

    expect(result.method).toBe('docx')
    expect(result.text).toBe('Лекция 3')
  })
})

describe('estimateTokens', () => {
  it('estimates ~3.5 chars per token', () => {
    // 35-char string → ceil(35/3.5) = 10
    expect(estimateTokens('a'.repeat(35))).toBe(10)
  })

  it('rounds up partial tokens', () => {
    expect(estimateTokens('hi')).toBe(1)  // ceil(2/3.5)
  })

  it('handles empty input', () => {
    expect(estimateTokens('')).toBe(0)
  })
})
