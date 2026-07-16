import { useEffect, useRef, useState, useCallback } from 'react'

// Warm, design-system dropdown — replaces bare native <select>, whose
// OS-rendered option list can't match the editorial aesthetic. Keyboard
// accessible (Enter/Space/Arrows/Escape), closes on outside-click. Depth comes
// from border + surface contrast only — no drop shadow, per the design rules.

export interface SelectOption {
  value: string
  label: string
  // Optional trailing hint shown muted on the right of the row (e.g. a count).
  hint?: string
}

interface Props {
  value:       string
  onChange:    (value: string) => void
  options:     SelectOption[]
  placeholder?: string
  /** Accessible label for the trigger button. */
  ariaLabel?:  string
  className?:  string
  /** 'sm' shrinks the trigger for inline use next to text actions (e.g. a card footer). */
  size?:       'sm' | 'md'
}

export default function Select({
  value, onChange, options, placeholder = 'Выберите…', ariaLabel, className = '', size = 'md',
}: Props) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)   // keyboard-focused option index
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = options.find((o) => o.value === value)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  // When opening, focus the active row on the currently-selected option
  useEffect(() => {
    if (open) {
      const idx = Math.max(0, options.findIndex((o) => o.value === value))
      setActive(idx)
    }
  }, [open, value, options])

  const choose = useCallback((v: string) => {
    onChange(v)
    setOpen(false)
  }, [onChange])

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault(); setOpen(true)
      }
      return
    }
    if (e.key === 'Escape')       { e.preventDefault(); setOpen(false) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, options.length - 1)) }
    else if (e.key === 'ArrowUp')   { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const opt = options[active]
      if (opt) choose(opt.value)
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={`w-full flex items-center justify-between gap-2 font-sans bg-surface
                    border rounded-md transition-colors
                    ${size === 'sm' ? 'text-xs px-2 py-1' : 'text-sm px-3 py-2'}
                    ${open ? 'border-border-strong' : 'border-border hover:border-border-mid'}`}
      >
        <span className={selected ? 'text-ink truncate' : 'text-ink-tertiary truncate'}>
          {selected ? selected.label : placeholder}
        </span>
        <svg
          width={size === 'sm' ? 11 : 14} height={size === 'sm' ? 11 : 14} viewBox="0 0 24 24" fill="none"
          className={`flex-shrink-0 text-ink-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          ref={listRef}
          role="listbox"
          aria-label={ariaLabel}
          className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-surface
                     border border-border-strong rounded-md py-1"
        >
          {options.map((o, i) => {
            const isSelected = o.value === value
            const isActive   = i === active
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => choose(o.value)}
                onMouseEnter={() => setActive(i)}
                className={`w-full flex items-center justify-between gap-2 text-left font-sans
                            px-3 py-1.5 transition-colors
                            ${size === 'sm' ? 'text-xs' : 'text-sm'}
                            ${isActive ? 'bg-surface-warm' : ''}
                            ${isSelected ? 'text-amber font-medium' : 'text-ink'}`}
              >
                <span className="truncate">{o.label}</span>
                <span className="flex items-center gap-2 flex-shrink-0">
                  {o.hint && <span className="text-xs text-ink-tertiary tabular-nums">{o.hint}</span>}
                  {isSelected && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" className="text-amber" aria-hidden="true">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2.5"
                            strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
