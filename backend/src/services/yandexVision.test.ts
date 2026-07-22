import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Rasterize-then-OCR path (2026-07-22 fix): a CCITT-encoded scanned PDF
// (the common compression for scanned government documents, confirmed
// against a real fgosvo.ru ФГОС) fails Yandex Vision's own PDF ingestion
// outright ("Can't decode Image: image: unknown format"), so PDFs are now
// rasterized to per-page PNGs via `pdf-to-img` before OCR. Mocked here the
// same way documentExtractor.test.ts mocks pdf-parse — vi.mock intercepts
// the module specifier regardless of whether the real package is installed.
const { pdfToImgMock } = vi.hoisted(() => ({ pdfToImgMock: vi.fn() }))
vi.mock('pdf-to-img', () => ({ pdf: pdfToImgMock }))

function textDetectionResponse(text: string) {
  return {
    results: [{ results: [{ textDetection: { pages: [{ blocks: [{ lines: [{ words: text.split(' ').map((w) => ({ text: w })) }] }] }] } }] }],
  }
}

describe('yandexVisionOCR', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    process.env.YANDEX_VISION_API_KEY = 'test-key'
    process.env.YANDEX_FOLDER_ID = 'test-folder'
    fetchMock.mockReset()
    pdfToImgMock.mockReset()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.YANDEX_VISION_API_KEY
    delete process.env.YANDEX_FOLDER_ID
  })

  it('returns empty string without throwing when Yandex Vision is not configured', async () => {
    delete process.env.YANDEX_VISION_API_KEY
    const { yandexVisionOCR } = await import('./yandexVision')
    const text = await yandexVisionOCR(Buffer.from('bytes'), 'application/pdf')
    expect(text).toBe('')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rasterizes a multi-page PDF and OCRs each page sequentially, joined by \\f', async () => {
    pdfToImgMock.mockResolvedValue([Buffer.from('page1-png'), Buffer.from('page2-png')])
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => textDetectionResponse('Первая страница') })
      .mockResolvedValueOnce({ ok: true, json: async () => textDetectionResponse('Вторая страница') })

    const { yandexVisionOCR } = await import('./yandexVision')
    const text = await yandexVisionOCR(Buffer.from('pdf bytes'), 'application/pdf')

    expect(text).toBe('Первая страница\fВторая страница')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to a single whole-PDF call when rasterization is unavailable', async () => {
    pdfToImgMock.mockRejectedValue(new Error('pdf-to-img not installed'))
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => textDetectionResponse('Текст без растеризации') })

    const { yandexVisionOCR } = await import('./yandexVision')
    const text = await yandexVisionOCR(Buffer.from('pdf bytes'), 'application/pdf')

    expect(text).toBe('Текст без растеризации')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sends a non-PDF image straight through without rasterizing', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => textDetectionResponse('Скан фото') })

    const { yandexVisionOCR } = await import('./yandexVision')
    const text = await yandexVisionOCR(Buffer.from('jpeg bytes'), 'image/jpeg')

    expect(text).toBe('Скан фото')
    expect(pdfToImgMock).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('throws when Yandex Vision returns a non-OK response', async () => {
    pdfToImgMock.mockResolvedValue([Buffer.from('page1-png')])
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500 })

    const { yandexVisionOCR } = await import('./yandexVision')
    await expect(yandexVisionOCR(Buffer.from('pdf bytes'), 'application/pdf')).rejects.toThrow('Yandex Vision API error: 500')
  })
})
