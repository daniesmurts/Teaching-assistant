import { useState } from 'react'

// A compact "or paste a link" affordance shown next to a file picker. The
// server fetches the document from the URL (restricted to the institution's
// own university domains), so a user doesn't have to download and re-upload.
// Collapsed to a single link until opened.
export default function UrlUploadField({
  onSubmit, disabled, label = 'или по ссылке', busy,
}: {
  onSubmit: (url: string) => void
  disabled?: boolean
  busy?:     boolean
  label?:    string
}) {
  const [open, setOpen] = useState(false)
  const [url, setUrl] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="inline-flex items-center gap-1 text-xs font-sans font-medium text-amber underline underline-offset-2 decoration-amber/40 hover:decoration-amber transition-colors disabled:opacity-40"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="flex-shrink-0">
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
        </svg>
        {label}
      </button>
    )
  }

  const trimmed = url.trim()
  function submit() {
    if (trimmed) onSubmit(trimmed)
  }

  return (
    <div className="flex flex-col gap-1 w-full">
      <div className="flex items-center gap-2">
        <input
          type="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
          placeholder="https://www.вашвуз.ru/…"
          autoFocus
          className="flex-1 min-w-0 text-xs font-sans bg-surface border border-border rounded-md px-2.5 py-1.5 outline-none focus:border-border-strong"
        />
        <button
          type="button"
          onClick={submit}
          disabled={disabled || busy || !trimmed}
          className="text-xs font-sans text-amber hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed whitespace-nowrap"
        >
          {busy ? 'Загружаем…' : 'Загрузить'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setUrl('') }}
          className="text-xs font-sans text-ink-tertiary hover:text-ink transition-colors"
          aria-label="Отменить"
        >
          ×
        </button>
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary">
        Ссылка принимается только с сайта вашего вуза — файл загрузит сервис.
      </p>
    </div>
  )
}
