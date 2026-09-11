import type { ReactNode } from 'react'

/**
 * «Как читать таблицу» — the warm aside that explains an artefact standing
 * next to it.
 *
 * Not a feature list and not onboarding (FeatureIntro is both of those). This
 * is for the one thing on a page that a competent user still reads wrongly:
 * the dot table whose colours look like grades, the button whose consequence
 * is invisible. It stays open — there is nothing to dismiss, because the
 * question it answers comes back every time the artefact does.
 *
 * Extracted from InstitutionProgramDetail, where it had been written out by
 * hand twice with identical chrome; a third use is where copying stops being
 * cheaper than a component.
 */
export default function ReadingGuide({ title, children, className = '' }: {
  title:     string
  children:  ReactNode
  className?: string
}) {
  return (
    <aside
      className={`w-full lg:w-72 flex-shrink-0 bg-amber-light/30 border border-amber/15 rounded-lg p-4 space-y-3 ${className}`}
    >
      <div className="text-[11px] font-sans font-semibold uppercase tracking-wide text-ink-secondary">
        {title}
      </div>
      {children}
    </aside>
  )
}

/**
 * A paragraph inside a guide. Exists so the three text styles that make these
 * asides readable — size, secondary ink, relaxed leading — are stated once
 * rather than repeated on every `<p>` and drifting apart.
 */
export function GuideText({ children }: { children: ReactNode }) {
  return <p className="text-xs font-sans text-ink-secondary leading-relaxed">{children}</p>
}

/** The words inside a guide that carry the point. */
export function GuideTerm({ children }: { children: ReactNode }) {
  return <span className="text-ink font-medium">{children}</span>
}
