import { describe, it, expect, vi, beforeEach } from 'vitest'

// Feature AN Phase 2 (TODO.md "### AN") — captionFigure's two-path dispatch:
// vision first when an image is supplied and available, OCR+text chatJSON
// otherwise or as a fallback. Mocks the registry surface, not deepseek.ts
// directly — captionFigure only ever talks to services/llm/registry.ts.

const { chatJSONMock, embedMock, captionImageMock } = vi.hoisted(() => ({
  chatJSONMock:    vi.fn(),
  embedMock:       vi.fn(),
  captionImageMock: vi.fn(),
}))
vi.mock('./llm/registry', () => ({
  chatJSON:     chatJSONMock,
  embed:        embedMock,
  captionImage: captionImageMock,
}))

import { captionFigure, embedFigureCaption } from './figureCaptioning'

describe('captionFigure', () => {
  beforeEach(() => {
    chatJSONMock.mockReset()
    embedMock.mockReset()
    captionImageMock.mockReset()
  })

  it('skips vision entirely when no image is supplied — goes straight to OCR+text', async () => {
    chatJSONMock.mockResolvedValueOnce({ caption: 'Вал редуктора', labels: ['01'] })

    const result = await captionFigure('Вал 01 ГОСТ', 'окружающий текст', undefined)

    expect(captionImageMock).not.toHaveBeenCalled()
    expect(chatJSONMock).toHaveBeenCalledOnce()
    expect(result).toEqual({ caption: 'Вал редуктора', labels: ['01'] })
  })

  it('returns an empty caption without any call when there is neither OCR text nor context and no image', async () => {
    const result = await captionFigure('', '', undefined)
    expect(result).toEqual({ caption: '', labels: [] })
    expect(chatJSONMock).not.toHaveBeenCalled()
    expect(captionImageMock).not.toHaveBeenCalled()
  })

  it('prefers a successful vision result over OCR+text — chatJSON is never called', async () => {
    captionImageMock.mockResolvedValueOnce({ caption: 'Шестерня с 24 зубьями', labels: ['24'] })

    const result = await captionFigure(
      'Вал 01', 'окружающий текст', undefined,
      { buffer: Buffer.from('img'), mime: 'image/png' }
    )

    expect(result).toEqual({ caption: 'Шестерня с 24 зубьями', labels: ['24'] })
    expect(chatJSONMock).not.toHaveBeenCalled()
  })

  it('falls back to OCR+text when vision returns null (disabled/unavailable/failed)', async () => {
    captionImageMock.mockResolvedValueOnce(null)
    chatJSONMock.mockResolvedValueOnce({ caption: 'Вал редуктора (из текста)', labels: [] })

    const result = await captionFigure(
      'Вал 01 ГОСТ', 'окружающий текст', undefined,
      { buffer: Buffer.from('img'), mime: 'image/png' }
    )

    expect(captionImageMock).toHaveBeenCalledOnce()
    expect(chatJSONMock).toHaveBeenCalledOnce()
    expect(result).toEqual({ caption: 'Вал редуктора (из текста)', labels: [] })
  })

  it('falls back to OCR+text when vision returns an empty caption', async () => {
    captionImageMock.mockResolvedValueOnce({ caption: '', labels: [] })
    chatJSONMock.mockResolvedValueOnce({ caption: 'из OCR', labels: [] })

    const result = await captionFigure(
      'текст с чертежа', '', undefined,
      { buffer: Buffer.from('img'), mime: 'image/png' }
    )

    expect(chatJSONMock).toHaveBeenCalledOnce()
    expect(result.caption).toBe('из OCR')
  })

  it('degrades to an empty caption when chatJSON itself throws', async () => {
    chatJSONMock.mockRejectedValueOnce(new Error('provider down'))
    const result = await captionFigure('текст', '', undefined)
    expect(result).toEqual({ caption: '', labels: [] })
  })
})

describe('embedFigureCaption', () => {
  beforeEach(() => { embedMock.mockReset() })

  it('embeds the caption when present', async () => {
    embedMock.mockResolvedValueOnce([1, 2, 3])
    const vector = await embedFigureCaption({ caption: 'Вал редуктора', labels: [] }, 'ocr text')
    expect(vector).toEqual([1, 2, 3])
    expect(embedMock).toHaveBeenCalledWith('Вал редуктора', undefined)
  })

  it('falls back to OCR text when the caption is empty', async () => {
    embedMock.mockResolvedValueOnce([4, 5, 6])
    await embedFigureCaption({ caption: '', labels: [] }, 'raw ocr text')
    expect(embedMock).toHaveBeenCalledWith('raw ocr text', undefined)
  })

  it('returns null when there is nothing to embed at all', async () => {
    const vector = await embedFigureCaption({ caption: '', labels: [] }, '')
    expect(vector).toBeNull()
    expect(embedMock).not.toHaveBeenCalled()
  })

  it('returns null when embed() throws', async () => {
    embedMock.mockRejectedValueOnce(new Error('embed failed'))
    const vector = await embedFigureCaption({ caption: 'caption', labels: [] }, '')
    expect(vector).toBeNull()
  })
})
