import { useMemo, useState } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import PublicHeader from '../../components/layout/PublicHeader'
import PublicFooter from '../../components/layout/PublicFooter'
import manifest from '../../generated/docs/manifest.json'
import type { DocsSection } from '../../lib/docsTypes'

const sections = manifest as DocsSection[]

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block text-sm py-0.5 rounded transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber focus-visible:outline-offset-2 ${
    isActive ? 'text-amber font-medium' : 'text-ink-secondary hover:text-ink'
  }`

const sectionLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block text-sm font-semibold mb-2 rounded transition-colors hover:text-amber focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber focus-visible:outline-offset-2 ${
    isActive ? 'text-amber' : 'text-ink'
  }`

export default function DocsLayout() {
  const [query, setQuery] = useState('')

  const filteredSections = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sections
    return sections
      .map((section) => ({
        ...section,
        articles: section.articles.filter(
          (a) => a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
        ),
      }))
      .filter((section) => section.articles.length > 0 || section.title.toLowerCase().includes(q))
  }, [query])

  const navTree = (
    <div className="space-y-6">
      {filteredSections.map((section) => (
        <div key={section.slug}>
          <NavLink to={`/docs/${section.slug}`} className={sectionLinkClass} end>
            {section.title}
          </NavLink>
          <ul className="space-y-1.5 border-l border-ink/10 pl-3">
            {section.articles.map((article) => (
              <li key={article.slug}>
                <NavLink to={`/docs/${section.slug}/${article.slug}`} className={navLinkClass}>
                  {article.title}
                </NavLink>
              </li>
            ))}
            {section.articles.length === 0 && (
              <li className="text-sm text-ink-secondary py-0.5">Скоро появятся статьи</li>
            )}
          </ul>
        </div>
      ))}
      {filteredSections.length === 0 && <p className="text-sm text-ink-secondary">Ничего не найдено.</p>}
    </div>
  )

  const searchInput = (
    <input
      type="search"
      value={query}
      onChange={(e) => setQuery(e.target.value)}
      placeholder="Поиск по документации…"
      aria-label="Поиск по документации"
      className="w-full mb-6 px-3 py-2 text-sm rounded-md border border-ink/10 bg-white focus:outline-none focus:ring-2 focus:ring-amber/40"
    />
  )

  return (
    <div className="min-h-screen bg-bg text-ink selection:bg-amber-light selection:text-ink font-sans flex flex-col">
      <PublicHeader />

      <div className="flex-1 max-w-[1200px] w-full mx-auto px-6 py-12 md:py-16 flex flex-col md:flex-row gap-10">
        {/* Desktop: persistent sidebar. On mobile a full nav tree would push
            the article below the fold, so it collapses behind a native
            <details> toggle instead — no JS state needed, keyboard-operable
            by default. */}
        <aside className="hidden md:block md:w-[260px] shrink-0">
          {searchInput}
          {navTree}
        </aside>

        <details className="md:hidden rounded-lg border border-ink/10 bg-white">
          <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium flex items-center justify-between">
            Разделы документации
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              className="w-4 h-4 text-ink-secondary"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <path d="M6 8l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="px-4 pb-4 pt-1">
            {searchInput}
            {navTree}
          </div>
        </details>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>

      <PublicFooter />
    </div>
  )
}
