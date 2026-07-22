import { useEffect, useRef, useState } from 'react'

// Searchable multi-select — sibling to Select.tsx, but for picking several
// items out of a long list (e.g. РОП Студия's ~90-region picker) rather
// than one. Doesn't close on pick (the point is checking off several in a
// row); a text filter narrows the list instead of scrolling through it.
// Same warm/bordered visual language as Select.tsx, no drop shadow.

export interface MultiSelectOption {
  value: string
  label: string
}

interface Props {
  values:      string[]
  onChange:    (values: string[]) => void
  options:     MultiSelectOption[]
  placeholder?: string
  ariaLabel?:  string
  className?:  string
}

export default function MultiSelect({
  values, onChange, options, placeholder = 'Выберите…', ariaLabel, className = '',
}: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (open) { setQuery(''); inputRef.current?.focus() }
  }, [open])

  const selectedLabels = options.filter((o) => values.includes(o.value)).map((o) => o.label)
  const normalizedQuery = query.trim().toLowerCase()
  const filtered = normalizedQuery
    ? options.filter((o) => o.label.toLowerCase().includes(normalizedQuery))
    : options

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value])
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center justify-between gap-2 font-sans bg-surface
                    border rounded-md transition-colors text-sm px-3 py-2
                    ${open ? 'border-border-strong' : 'border-border hover:border-border-mid'}`}
      >
        <span className={values.length > 0 ? 'text-ink truncate text-left' : 'text-ink-tertiary truncate text-left'}>
          {values.length === 0 ? placeholder
            : values.length <= 2 ? selectedLabels.join(', ')
            : `${selectedLabels[0]} и ещё ${values.length - 1}`}
        </span>
        <svg
          width={14} height={14} viewBox="0 0 24 24" fill="none"
          className={`flex-shrink-0 text-ink-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-20 mt-1 w-full bg-surface border border-border-strong rounded-md shadow-none flex flex-col max-h-80">
          <div className="p-1.5 border-b border-border flex-shrink-0">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск региона…"
              className="w-full px-2 py-1 text-xs font-sans bg-canvas border border-border rounded focus:outline-none focus:border-border-strong"
            />
          </div>
          <div role="listbox" aria-label={ariaLabel} aria-multiselectable="true" className="overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs font-sans text-ink-tertiary">Ничего не найдено.</p>
            ) : (
              filtered.map((o) => {
                const checked = values.includes(o.value)
                return (
                  <label
                    key={o.value}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-sans text-ink cursor-pointer hover:bg-surface-warm"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(o.value)}
                      className="accent-amber flex-shrink-0"
                    />
                    <span className="truncate">{o.label}</span>
                  </label>
                )
              })
            )}
          </div>
          {values.length > 0 && (
            <div className="flex-shrink-0 border-t border-border px-3 py-1.5 flex items-center justify-between">
              <span className="text-xs font-sans text-ink-tertiary">{values.length} выбрано</span>
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-xs font-sans text-ink-tertiary hover:text-danger"
              >
                Очистить
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
