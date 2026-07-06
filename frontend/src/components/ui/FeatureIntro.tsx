import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'

interface Props {
  id:           string          // stable key — remembers collapsed state per page
  title:        string
  description:  string
  steps?:       string[]
  videoSlug?:   string          // matches a HelpVideo slug — links to its how-to video
}

/**
 * A warm, dismissible "how this works" card for the top of a feature page.
 * Expanded by default for newcomers; once collapsed, it stays collapsed for
 * that user (persisted) but can always be reopened — never nags, never hides
 * the explanation for good.
 */
export default function FeatureIntro({ id, title, description, steps, videoSlug }: Props) {
  const storageKey = `feat_intro_${id}`
  const [open, setOpen] = useState<boolean>(() => {
    try { return localStorage.getItem(storageKey) !== 'collapsed' } catch { return true }
  })

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      try { localStorage.setItem(storageKey, next ? 'open' : 'collapsed') } catch { /* ignore */ }
      return next
    })
  }

  return (
    <div className="bg-amber-light/50 border border-amber/20 rounded-lg mb-6 overflow-hidden">
      <button
        onClick={toggle}
        className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-amber-light/70 transition-colors"
        aria-expanded={open}
      >
        <span className="text-amber text-sm flex-shrink-0 leading-none">✦</span>
        <span className="flex-1 text-sm font-sans font-medium text-ink">{title}</span>
        <span className="text-ink-tertiary text-xs flex-shrink-0">
          {open ? 'Скрыть' : 'Как это работает?'}
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 pt-0.5">
          <p className="text-[13px] font-sans text-ink-secondary leading-relaxed">{description}</p>
          {steps && steps.length > 0 && (
            <ol className="mt-3 space-y-1.5">
              {steps.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] font-sans text-ink-secondary leading-relaxed">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber/15 text-amber text-[11px] font-semibold flex items-center justify-center mt-px">
                    {i + 1}
                  </span>
                  <span>{step}</span>
                </li>
              ))}
            </ol>
          )}
          {videoSlug && (
            <Link
              to={`/help?video=${videoSlug}`}
              className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-sans font-medium text-amber hover:underline"
            >
              <Icon name="play-circle" size={14} />
              Смотреть видео
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
