import { describe, it, expect, vi } from 'vitest'

// A slide image from this app's own storage is addressed by a ROOT-RELATIVE
// proxy URL. fetch() cannot take one, so those images used to export as a
// placeholder even though the bytes were in storage this process can read.
const { downloadObject, getPresentationMediaById, getFigureById } = vi.hoisted(() => ({
  downloadObject: vi.fn(async () => Buffer.from('PNGBYTES')),
  getPresentationMediaById: vi.fn(async (id: string) =>
    id === '11111111-1111-4111-8111-111111111111'
      ? { storage_path: 'presentations/t1/deck1/0.png', mime_type: 'image/png' }
      : null),
  getFigureById: vi.fn(async () => ({ storage_path: 'figures/1.png', mime_type: 'image/png' })),
}))

vi.mock('./objectStorage', () => ({ downloadObject }))
vi.mock('../db/queries/presentationMedia', () => ({ getPresentationMediaById }))
vi.mock('../db/queries/documentFigures', () => ({ getFigureById }))

import { generatePresentationPptx } from './presentationExport'
import type { Presentation, Slide } from '../../../shared/types'

const MEDIA_ID  = '11111111-1111-4111-8111-111111111111'
const FIGURE_ID = '22222222-2222-4222-8222-222222222222'

const deckWith = (url: string): Presentation => ({
  id: 'p1', teacher_id: 't1', topic: 'ВСС на базе ЖКВН', slides: [
    { type: 'bullets', title: 'Рис. 1', notes: '', citations: [], body: { items: ['схема'] },
      image: { url, source_url: url, thumbnail: url, width: 800, height: 600,
               query: 'схема', source_host: 'Из загруженной презентации' } },
  ] as unknown as Slide[],
  generated_content: '', sources: [], created_at: '2026-09-08T00:00:00.000Z',
} as unknown as Presentation)

describe('stored slide images in the export', () => {
  it('reads an imported picture straight from storage', async () => {
    const pptx = await generatePresentationPptx(deckWith(`/api/presentations/media/${MEDIA_ID}/image`))
    expect(getPresentationMediaById).toHaveBeenCalledWith(MEDIA_ID)
    expect(downloadObject).toHaveBeenCalledWith('presentations/t1/deck1/0.png')
    expect(pptx.subarray(0, 4).toString('hex')).toBe('504b0304')
  })

  it('does the same for a кафедра library figure', async () => {
    // Same defect, older feature: figure URLs are relative too, so every deck
    // carrying one exported the picture as a placeholder.
    await generatePresentationPptx(deckWith(`/api/documents/figures/${FIGURE_ID}/image`))
    expect(getFigureById).toHaveBeenCalledWith(FIGURE_ID)
  })

  it('never reaches the network for a relative URL', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await generatePresentationPptx(deckWith(`/api/presentations/media/${MEDIA_ID}/image`))
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('still produces a deck when the stored object is gone', async () => {
    downloadObject.mockRejectedValueOnce(new Error('no such key'))
    const pptx = await generatePresentationPptx(deckWith(`/api/presentations/media/${MEDIA_ID}/image`))
    expect(pptx.length).toBeGreaterThan(0)
  })
})
