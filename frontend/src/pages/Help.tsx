import { useState, useMemo } from 'react'
import TopBar from '../components/layout/TopBar'
import Markdown from '../components/help/Markdown'
import { HELP_ARTICLES, HELP_CATEGORIES, type HelpArticle } from '../data/helpArticles'

export default function Help() {
  const [activeSlug, setActiveSlug] = useState<string>(HELP_ARTICLES[0]?.slug ?? '')
  const [query, setQuery] = useState('')

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => {
    if (!q) return HELP_ARTICLES
    return HELP_ARTICLES.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q)
    )
  }, [q])

  const active: HelpArticle | undefined =
    filtered.find((a) => a.slug === activeSlug) ?? filtered[0]

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar title="Помощь" />
      <div className="flex-1 flex overflow-hidden">

        {/* Article nav */}
        <aside className="w-[280px] border-r border-border bg-surface-warm overflow-y-auto flex-shrink-0 hidden md:flex md:flex-col">
          <div className="p-3 border-b border-border bg-surface-warm sticky top-0 z-10">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по справке…"
              className="w-full px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
            />
          </div>
          <nav className="p-3">
            {HELP_CATEGORIES.map((cat, idx) => {
              const items = filtered.filter((a) => a.category === cat)
              if (items.length === 0) return null
              return (
                <div key={cat} className={idx === 0 ? 'mb-5' : 'mb-5'}>
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[11px] font-sans font-bold text-ink uppercase tracking-[0.08em]">{cat}</span>
                    <span className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-sans text-ink-tertiary tabular-nums">{items.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {items.map((a) => {
                      const isActive = active?.slug === a.slug
                      return (
                        <button
                          key={a.slug}
                          onClick={() => setActiveSlug(a.slug)}
                          className={`relative w-full text-left pl-3 pr-2 py-1.5 rounded-md text-[13.5px] font-sans leading-snug transition-colors ${
                            isActive
                              ? 'bg-amber-light text-amber font-medium'
                              : 'text-ink-secondary hover:bg-surface hover:text-ink'
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-amber" aria-hidden />
                          )}
                          {a.title}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-2 py-4 text-xs font-sans text-ink-tertiary">Ничего не найдено.</p>
            )}
          </nav>
        </aside>

        {/* Article content */}
        <div className="flex-1 overflow-y-auto">
          {/* Mobile search + selector */}
          <div className="md:hidden p-3 border-b border-border bg-surface-warm space-y-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Поиск по справке…"
              className="w-full px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
            />
            <select
              value={active?.slug ?? ''}
              onChange={(e) => setActiveSlug(e.target.value)}
              className="w-full px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md"
            >
              {filtered.map((a) => <option key={a.slug} value={a.slug}>{a.title}</option>)}
            </select>
          </div>

          <div className="max-w-2xl mx-auto px-5 md:px-8 py-6">
            {active ? <Markdown>{active.body}</Markdown> : (
              <p className="font-sans text-sm text-ink-tertiary">Выберите статью слева.</p>
            )}

            <div className="mt-10 pt-5 border-t border-border">
              <p className="font-sans text-xs text-ink-tertiary">
                Не нашли ответ? Напишите нам:{' '}
                <a href="mailto:support@ispum.ru" className="text-amber hover:underline">support@ispum.ru</a>
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
