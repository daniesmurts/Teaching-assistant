import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMutation } from '@tanstack/react-query'
import { searchSlideImages, setSlideImage } from '../../api/presentations'
import type { ImageCandidate, SlideImage } from '../../types'

interface Props {
  presentationId: string
  slideIdx:       number
  query:          string
  onPick:         (image: SlideImage | null) => void
  triggerLabel:   string
}

export default function SlideImagePicker({
  presentationId, slideIdx, query, onPick, triggerLabel,
}: Props) {
  const [open, setOpen] = useState(false)
  const [queryInput, setQueryInput] = useState(query)
  const [results, setResults] = useState<ImageCandidate[] | null>(null)

  const searchMut = useMutation({
    mutationFn: (q: string) => searchSlideImages(presentationId, slideIdx, q),
    onSuccess: (res) => setResults(res.candidates),
  })

  const setMut = useMutation({
    mutationFn: (image: SlideImage | null) =>
      setSlideImage(presentationId, slideIdx, image),
  })

  // Disable the trigger entirely if we don't have a presentation id yet
  // (e.g. the form is showing a not-yet-saved preview).
  if (!presentationId) return null

  function openModal() {
    setOpen(true)
    setQueryInput(query)
    if (!results) searchMut.mutate(query)
  }

  function close() {
    setOpen(false)
    setResults(null)
    searchMut.reset()
  }

  function pick(c: ImageCandidate) {
    const image: SlideImage = {
      url:         c.url,
      source_url:  c.source_url,
      thumbnail:   c.thumbnail,
      width:       c.width,
      height:      c.height,
      query:       queryInput,
      source_host: c.source_host,
    }
    setMut.mutate(image, {
      onSuccess: () => {
        onPick(image)
        close()
      },
    })
  }

  function clear() {
    setMut.mutate(null, {
      onSuccess: () => {
        onPick(null)
        close()
      },
    })
  }

  // Lock body scroll while the modal is open so the picker doesn't drift
  // off-screen when the underlying page is mid-scroll.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  // The modal renders through a portal into <body> rather than inline. Inline
  // rendering means any ancestor with transform/filter/contain promotes itself
  // to the containing block for `position: fixed`, which can drop the modal
  // outside the viewport on long pages. The portal sidesteps it.
  const modal = open && (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 overflow-y-auto"
      onClick={close}
    >
      <div
        className="bg-surface rounded-xl w-full max-w-3xl my-8 shadow-sm border border-border max-h-[calc(100vh-4rem)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
            {/* Header + query */}
            <div className="flex items-start gap-3 px-5 py-4 border-b border-border">
              <div className="flex-1">
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5">
                  Поиск изображения
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={queryInput}
                    onChange={(e) => setQueryInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        searchMut.mutate(queryInput)
                      }
                    }}
                    placeholder="например, осевой насос разрез"
                    className="flex-1 px-3 py-1.5 text-sm font-sans bg-surface-warm border border-border rounded-md focus:outline-none focus:border-amber"
                  />
                  <button
                    type="button"
                    onClick={() => searchMut.mutate(queryInput)}
                    disabled={searchMut.isPending || queryInput.trim().length < 3}
                    className="px-3 py-1.5 text-sm font-sans font-medium bg-amber text-white rounded-md hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    {searchMut.isPending ? '...' : 'Найти'}
                  </button>
                </div>
              </div>
              <button
                onClick={close}
                className="text-ink-tertiary hover:text-ink transition-colors text-2xl leading-none -mt-1"
                aria-label="Закрыть"
              >×</button>
            </div>

            {/* Body — scrolls if results exceed remaining viewport height */}
            <div className="px-5 py-4 min-h-[240px] overflow-y-auto flex-1">
              {searchMut.isPending && (
                <div className="grid grid-cols-3 gap-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="aspect-[4/3] bg-surface-warm rounded-md animate-pulse" />
                  ))}
                </div>
              )}

              {!searchMut.isPending && searchMut.isError && (
                <div className="text-sm font-sans text-danger text-center py-8">
                  Не удалось получить результаты. Попробуйте уточнить запрос.
                </div>
              )}

              {!searchMut.isPending && results && results.length === 0 && (
                <div className="text-sm font-sans text-ink-tertiary text-center py-8">
                  Ничего не найдено. Попробуйте другой запрос.
                </div>
              )}

              {!searchMut.isPending && results && results.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {results.map((c, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => pick(c)}
                      disabled={setMut.isPending}
                      title={c.source_host || c.source_url}
                      className="group relative aspect-[4/3] bg-surface-warm rounded-md overflow-hidden border border-border hover:border-amber transition-colors disabled:opacity-50"
                    >
                      <img
                        src={c.thumbnail}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                      {c.source_host && (
                        <div className="absolute bottom-0 inset-x-0 bg-black/55 text-white text-[10px] font-sans px-2 py-0.5 opacity-0 group-hover:opacity-100 transition-opacity truncate">
                          {c.source_host}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Footer — clear + attribution warning */}
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
              <div className="text-[10px] font-sans text-ink-tertiary leading-snug">
                Проверьте лицензию изображения перед использованием в публичных материалах.
              </div>
              <button
                type="button"
                onClick={clear}
                disabled={setMut.isPending}
                className="text-[11px] font-sans text-ink-secondary hover:text-danger transition-colors disabled:opacity-50"
              >
                Убрать изображение
              </button>
            </div>
          </div>
        </div>
  )

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className="text-[11px] font-sans font-medium text-amber hover:underline transition-colors"
      >
        {triggerLabel}
      </button>
      {modal && createPortal(modal, document.body)}
    </>
  )
}
