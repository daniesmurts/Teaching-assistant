import { describe, it, expect, vi, beforeEach } from 'vitest'

const { uploadObject, deleteObject, createPresentationMedia, listPresentationMediaPaths } = vi.hoisted(() => ({
  uploadObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
  createPresentationMedia: vi.fn(async (data: { slideIndex: number }) => ({ id: `media-${data.slideIndex}` })),
  listPresentationMediaPaths: vi.fn(async () => ['a/1.png', 'a/2.png']),
}))

vi.mock('./objectStorage', () => ({ uploadObject, deleteObject, downloadObject: vi.fn() }))
vi.mock('../db/queries/presentationMedia', () => ({ createPresentationMedia, listPresentationMediaPaths }))

import { attachImportedImages, deletePresentationMediaObjects } from './presentationMedia'
import type { Slide } from '../../../shared/types'
import type { ImportedSlide } from './pptxImport'

const picture = (w: number, h: number) => ({ buffer: Buffer.alloc(64), mime: 'image/png', width: w, height: h })
const slide = (title: string): Slide =>
  ({ type: 'bullets', title, notes: '', citations: [], body: { items: ['раз'] } }) as unknown as Slide
const source = (images: ReturnType<typeof picture>[]): ImportedSlide =>
  ({ title: 'x', bullets: [], notes: '', images })

beforeEach(() => vi.clearAllMocks())

describe('attachImportedImages', () => {
  it('puts each slide’s picture on that slide, not the next one', async () => {
    const result = await attachImportedImages('deck1', 't1',
      [slide('Рис. 1'), slide('Рис. 2')],
      [source([picture(800, 600)]), source([picture(400, 300)])])

    expect(result.stored).toBe(2)
    expect(result.slides[0].image?.url).toBe('/api/presentations/media/media-0/image')
    expect(result.slides[1].image?.url).toBe('/api/presentations/media/media-1/image')
    expect(result.slides[0].image).toMatchObject({ width: 800, height: 600 })
  })

  it('leaves a text-only slide without an image', async () => {
    const result = await attachImportedImages('deck1', 't1',
      [slide('Повестка'), slide('Рис. 1')],
      [source([]), source([picture(800, 600)])])

    expect(result.slides[0].image).toBeUndefined()
    expect(result.slides[1].image?.url).toBe('/api/presentations/media/media-1/image')
    expect(result.stored).toBe(1)
  })

  it('reports the extra pictures it had to drop rather than hiding them', async () => {
    // A slide carries one image (shared/types.ts's SlideBase). The count is
    // what lets the UI say so instead of quietly importing three of five.
    const result = await attachImportedImages('deck1', 't1', [slide('Рис. 1')],
      [source([picture(900, 700), picture(300, 200), picture(150, 150)])])

    expect(result.stored).toBe(1)
    expect(result.dropped).toBe(2)
  })

  it('keeps the rest of the deck when one picture fails to store', async () => {
    // Half an import beats an error after the teacher has already waited.
    uploadObject.mockRejectedValueOnce(new Error('storage down'))
    const result = await attachImportedImages('deck1', 't1',
      [slide('Рис. 1'), slide('Рис. 2')],
      [source([picture(800, 600)]), source([picture(800, 600)])])

    expect(result.stored).toBe(1)
    expect(result.dropped).toBe(1)
    expect(result.slides[1].image?.url).toBe('/api/presentations/media/media-1/image')
  })

  it('writes each object under the deck it belongs to', async () => {
    await attachImportedImages('deck1', 't1', [slide('Рис. 1')], [source([picture(800, 600)])])
    expect(uploadObject).toHaveBeenCalledWith(expect.any(Buffer), 'presentations/t1/deck1/0.png', 'image/png')
  })

  it('does not credit an imported picture as a web source', async () => {
    const result = await attachImportedImages('deck1', 't1', [slide('Рис. 1')], [source([picture(800, 600)])])
    expect(result.slides[0].image?.source_host).toBe('Из загруженной презентации')
  })
})

describe('deletePresentationMediaObjects', () => {
  it('deletes every stored object for the deck', async () => {
    await deletePresentationMediaObjects('deck1')
    expect(deleteObject).toHaveBeenCalledWith('a/1.png')
    expect(deleteObject).toHaveBeenCalledWith('a/2.png')
  })

  it('never throws — a storage hiccup must not block deleting the deck', async () => {
    listPresentationMediaPaths.mockRejectedValueOnce(new Error('db down'))
    await expect(deletePresentationMediaObjects('deck1')).resolves.toBeUndefined()
  })
})
