import { useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from './Icon'

interface Props {
  id:           string          // stable key — remembers collapsed state per page
  title:        string
  // Optional: an `actions` card that already names every capability does not
  // need a sentence above them saying it is about to.
  description?: string
  steps?:       string[]
  // Capabilities rather than a sequence. Numbered circles would say "do these
  // in this order", which is wrong for a list of things a page can do — and
  // wrong in a way a newcomer would believe. Two columns from `sm` up: seven
  // one-line items in a single column is a 300px wall that pushes the actual
  // lecture off the screen.
  actions?:     { label: string; text: string }[]
  // 'warm' is the page-top card every feature page opens with. 'quiet' is for
  // an instance that sits OVER content rather than above it — same component,
  // but it must not out-shout the thing it explains (§5 visual-hierarchy).
  tone?:        'warm' | 'quiet'
  videoSlug?:   string          // matches a HelpVideo slug — links to its how-to video
}

/**
 * A warm, dismissible "how this works" card for the top of a feature page.
 * Expanded by default for newcomers; once collapsed, it stays collapsed for
 * that user (persisted) but can always be reopened — never nags, never hides
 * the explanation for good.
 */
export default function FeatureIntro({ id, title, description, steps, actions, tone = 'warm', videoSlug }: Props) {
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

  const warm = tone === 'warm'

  return (
    <div className={`border rounded-lg mb-4 overflow-hidden ${
      warm ? 'bg-amber-light/50 border-amber/20' : 'bg-surface border-border'
    }`}>
      <button
        onClick={toggle}
        className={`w-full flex items-center gap-2.5 px-4 py-3 text-left transition-colors ${
          warm ? 'hover:bg-amber-light/70' : 'hover:bg-surface-warm'
        }`}
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
          {description && (
            <p className="text-[13px] font-sans text-ink-secondary leading-relaxed">{description}</p>
          )}
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
          {actions && actions.length > 0 && (
            <ul className="mt-1 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
              {actions.map((action) => (
                <li key={action.label} className="flex gap-2 text-[13px] font-sans text-ink-secondary leading-relaxed">
                  <span className="text-amber flex-shrink-0 leading-relaxed" aria-hidden>•</span>
                  <span>
                    <span className="font-medium text-ink">{action.label}</span>
                    {' — '}{action.text}
                  </span>
                </li>
              ))}
            </ul>
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
