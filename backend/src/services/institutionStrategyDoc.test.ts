import { describe, it, expect, vi, beforeEach } from 'vitest'

const { uploadObjectMock, extractTextMock, embedMock, replaceStrategyDocumentMock,
  setStrategyDocumentStatusMock, setStrategyDocumentFailedMock, setStrategyDocumentExtractedTextMock,
  insertStrategyChunkMock } = vi.hoisted(() => ({
  uploadObjectMock:   vi.fn(),
  extractTextMock:    vi.fn(),
  embedMock:          vi.fn(),
  replaceStrategyDocumentMock:         vi.fn(),
  setStrategyDocumentStatusMock:       vi.fn(),
  setStrategyDocumentFailedMock:       vi.fn(),
  setStrategyDocumentExtractedTextMock: vi.fn(),
  insertStrategyChunkMock:             vi.fn(),
}))

vi.mock('./objectStorage', () => ({ uploadObject: uploadObjectMock }))
vi.mock('./documentExtractor', () => ({ extractText: extractTextMock }))
vi.mock('./deepseek', () => ({ embed: embedMock }))
vi.mock('../db/queries/institutionStrategyDoc', () => ({
  replaceStrategyDocument:          replaceStrategyDocumentMock,
  setStrategyDocumentStatus:        setStrategyDocumentStatusMock,
  setStrategyDocumentFailed:        setStrategyDocumentFailedMock,
  setStrategyDocumentExtractedText: setStrategyDocumentExtractedTextMock,
  insertStrategyChunk:              insertStrategyChunkMock,
}))

import { uploadStrategyDocument } from './institutionStrategyDoc'

const DOC_ROW = {
  id: 'doc-1', institution_id: 'inst-1', file_name: 'strategy.pdf',
  storage_path: 'institution-strategy/inst-1/x.pdf', extracted_text: null,
  processing_status: 'pending' as const, error_message: null,
  uploaded_by: 'teacher-1', uploaded_at: new Date(),
}

// A page break + two paragraphs long enough to clear chunker's 30-char filter
// and produce at least one real chunk.
const LONG_TEXT =
  'Приоритет развития университета — подготовка инженерных кадров для региона на ближайшие годы.'

describe('uploadStrategyDocument', () => {
  beforeEach(() => {
    uploadObjectMock.mockReset().mockResolvedValue(undefined)
    extractTextMock.mockReset().mockResolvedValue({ text: LONG_TEXT, method: 'text_layer' })
    embedMock.mockReset().mockResolvedValue(new Array(256).fill(0.01)) // Yandex text-search-doc is 256-dim
    replaceStrategyDocumentMock.mockReset().mockResolvedValue(DOC_ROW)
    setStrategyDocumentStatusMock.mockReset().mockResolvedValue(undefined)
    setStrategyDocumentFailedMock.mockReset().mockResolvedValue(undefined)
    setStrategyDocumentExtractedTextMock.mockReset().mockResolvedValue(undefined)
    insertStrategyChunkMock.mockReset().mockResolvedValue(undefined)
  })

  it('uploads the file and replaces any prior document for the institution', async () => {
    const doc = await uploadStrategyDocument({
      institutionId: 'inst-1', teacherId: 'teacher-1',
      fileBuffer: Buffer.from('pdf-bytes'), fileName: 'strategy.pdf', mimeType: 'application/pdf',
    })

    expect(doc).toEqual(DOC_ROW)
    expect(uploadObjectMock).toHaveBeenCalledOnce()
    expect(replaceStrategyDocumentMock).toHaveBeenCalledWith(
      expect.objectContaining({ institutionId: 'inst-1', fileName: 'strategy.pdf', uploadedBy: 'teacher-1' })
    )
  })

  it('extracts, chunks, and embeds in the background, then marks the document ready', async () => {
    await uploadStrategyDocument({
      institutionId: 'inst-1', teacherId: 'teacher-1',
      fileBuffer: Buffer.from('pdf-bytes'), fileName: 'strategy.pdf', mimeType: 'application/pdf',
    })
    // Background processing isn't awaited by uploadStrategyDocument — flush microtasks.
    await new Promise((r) => setTimeout(r, 0))

    expect(extractTextMock).toHaveBeenCalledOnce()
    expect(setStrategyDocumentExtractedTextMock).toHaveBeenCalledWith('doc-1', LONG_TEXT)
    expect(insertStrategyChunkMock).toHaveBeenCalled()
    expect(setStrategyDocumentStatusMock).toHaveBeenLastCalledWith('doc-1', 'ready')
  })

  it('does not abort the document when a single chunk fails to embed (fail-soft, matches documents.ts)', async () => {
    insertStrategyChunkMock.mockRejectedValueOnce(new Error('embed failed'))

    await uploadStrategyDocument({
      institutionId: 'inst-1', teacherId: 'teacher-1',
      fileBuffer: Buffer.from('pdf-bytes'), fileName: 'strategy.pdf', mimeType: 'application/pdf',
    })
    await new Promise((r) => setTimeout(r, 0))

    // Still reaches 'ready' despite the chunk failure.
    expect(setStrategyDocumentStatusMock).toHaveBeenLastCalledWith('doc-1', 'ready')
  })

  it('marks the document failed when extraction itself throws', async () => {
    extractTextMock.mockRejectedValueOnce(new Error('corrupt PDF'))

    await uploadStrategyDocument({
      institutionId: 'inst-1', teacherId: 'teacher-1',
      fileBuffer: Buffer.from('pdf-bytes'), fileName: 'strategy.pdf', mimeType: 'application/pdf',
    })
    await new Promise((r) => setTimeout(r, 0))

    expect(setStrategyDocumentFailedMock).toHaveBeenCalledWith('doc-1', 'corrupt PDF')
  })
})
