import { useState, useMemo, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import TopBar from '../components/layout/TopBar'
import Markdown from '../components/help/Markdown'
import VkVideoEmbed from '../components/help/VkVideoEmbed'
import ArticleFeedback from '../components/help/ArticleFeedback'
import Icon from '../components/ui/Icon'
import { HELP_ARTICLES, HELP_CATEGORIES, type HelpArticle } from '../data/helpArticles'
import { HELP_VIDEOS, VIDEO_CATEGORIES, type HelpVideo } from '../data/helpVideos'
import { submitFeedback } from '../api/feedback'

type ActiveKey = { kind: 'article'; slug: string } | { kind: 'video'; slug: string }

export default function Help() {
  const [searchParams, setSearchParams] = useSearchParams()

  const initialKey: ActiveKey = searchParams.get('video')
    ? { kind: 'video', slug: searchParams.get('video')! }
    : { kind: 'article', slug: searchParams.get('article') ?? HELP_ARTICLES[0]?.slug ?? '' }

  const [activeKey, setActiveKey] = useState<ActiveKey>(initialKey)
  const [query, setQuery] = useState('')

  function select(key: ActiveKey) {
    setActiveKey(key)
    setSearchParams(key.kind === 'video' ? { video: key.slug } : { article: key.slug }, { replace: true })
  }

  const q = query.trim().toLowerCase()
  const filteredArticles = useMemo(() => {
    if (!q) return HELP_ARTICLES
    return HELP_ARTICLES.filter((a) =>
      a.title.toLowerCase().includes(q) ||
      a.summary.toLowerCase().includes(q) ||
      a.body.toLowerCase().includes(q)
    )
  }, [q])
  const filteredVideos = useMemo(() => {
    if (!q) return HELP_VIDEOS
    return HELP_VIDEOS.filter((v) => v.title.toLowerCase().includes(q))
  }, [q])

  const activeArticle: HelpArticle | undefined =
    activeKey.kind === 'article' ? HELP_ARTICLES.find((a) => a.slug === activeKey.slug) : undefined
  const activeVideo: HelpVideo | undefined =
    activeKey.kind === 'video' ? HELP_VIDEOS.find((v) => v.slug === activeKey.slug) : undefined

  // A video may point back at a full article, and vice versa — cross-link them.
  const relatedVideo = activeArticle
    ? HELP_VIDEOS.find((v) => v.articleSlug === activeArticle.slug)
    : undefined
  const relatedArticle = activeVideo?.articleSlug
    ? HELP_ARTICLES.find((a) => a.slug === activeVideo.articleSlug)
    : undefined

  const nothingFound = filteredArticles.length === 0 && filteredVideos.length === 0

  // Log searches that come back empty — a stronger "missing article" signal
  // than any rating, and it works from the very first search. Debounced so
  // we log the settled query, not every keystroke; skipped if unchanged.
  const lastLoggedQuery = useRef<string | null>(null)
  useEffect(() => {
    if (!nothingFound || q.length < 3) return
    const timer = setTimeout(() => {
      if (lastLoggedQuery.current === q) return
      lastLoggedQuery.current = q
      submitFeedback({ category: 'help_search', message: q, page: 'help:search' }).catch(() => null)
    }, 1200)
    return () => clearTimeout(timer)
  }, [q, nothingFound])

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <TopBar title="Помощь" />
      <div className="flex-1 flex overflow-hidden">

        {/* Nav */}
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
            {HELP_CATEGORIES.map((cat) => {
              const items = filteredArticles.filter((a) => a.category === cat)
              if (items.length === 0) return null
              return (
                <div key={cat} className="mb-5">
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[11px] font-sans font-bold text-ink uppercase tracking-[0.08em]">{cat}</span>
                    <span className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-sans text-ink-tertiary tabular-nums">{items.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {items.map((a) => {
                      const isActive = activeKey.kind === 'article' && activeKey.slug === a.slug
                      return (
                        <button
                          key={a.slug}
                          onClick={() => select({ kind: 'article', slug: a.slug })}
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

            {VIDEO_CATEGORIES.map((cat) => {
              const items = filteredVideos.filter((v) => v.category === cat)
              if (items.length === 0) return null
              return (
                <div key={`video-${cat}`} className="mb-5">
                  <div className="flex items-center gap-2 px-1 mb-2">
                    <span className="text-[11px] font-sans font-bold text-ink uppercase tracking-[0.08em]">Видео: {cat}</span>
                    <span className="flex-1 h-px bg-border" />
                    <span className="text-[10px] font-sans text-ink-tertiary tabular-nums">{items.length}</span>
                  </div>
                  <div className="space-y-0.5">
                    {items.map((v) => {
                      const isActive = activeKey.kind === 'video' && activeKey.slug === v.slug
                      return (
                        <button
                          key={v.slug}
                          onClick={() => select({ kind: 'video', slug: v.slug })}
                          className={`relative w-full flex items-center gap-1.5 text-left pl-3 pr-2 py-1.5 rounded-md text-[13.5px] font-sans leading-snug transition-colors ${
                            isActive
                              ? 'bg-amber-light text-amber font-medium'
                              : 'text-ink-secondary hover:bg-surface hover:text-ink'
                          }`}
                        >
                          {isActive && (
                            <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-amber" aria-hidden />
                          )}
                          <Icon name="play-circle" size={13} className="flex-shrink-0 opacity-60" />
                          <span>{v.title}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )
            })}

            {nothingFound && (
              <p className="px-2 py-4 text-xs font-sans text-ink-tertiary">Ничего не найдено.</p>
            )}
          </nav>
        </aside>

        {/* Content */}
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
              value={activeKey.kind === 'article' ? `article:${activeKey.slug}` : `video:${activeKey.slug}`}
              onChange={(e) => {
                const [kind, slug] = e.target.value.split(':') as ['article' | 'video', string]
                select({ kind, slug })
              }}
              className="w-full px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md"
            >
              <optgroup label="Статьи">
                {filteredArticles.map((a) => <option key={a.slug} value={`article:${a.slug}`}>{a.title}</option>)}
              </optgroup>
              <optgroup label="Видео">
                {filteredVideos.map((v) => <option key={v.slug} value={`video:${v.slug}`}>{v.title}</option>)}
              </optgroup>
            </select>
          </div>

          <div className="max-w-2xl mx-auto px-5 md:px-8 py-6">
            {activeArticle && (
              <>
                {relatedVideo && (
                  <button
                    onClick={() => select({ kind: 'video', slug: relatedVideo.slug })}
                    className="mb-5 w-full flex items-center gap-2.5 px-4 py-3 rounded-lg bg-amber-light/50 border border-amber/20 hover:bg-amber-light/70 transition-colors text-left"
                  >
                    <Icon name="play-circle" size={16} className="flex-shrink-0 text-amber" />
                    <span className="flex-1 text-sm font-sans font-medium text-ink">Смотреть видео-инструкцию</span>
                    <span className="text-ink-tertiary text-xs flex-shrink-0">→</span>
                  </button>
                )}
                <Markdown>{activeArticle.body}</Markdown>
                <ArticleFeedback key={activeArticle.slug} slug={activeArticle.slug} title={activeArticle.title} />
              </>
            )}

            {activeVideo && (
              <>
                <h1 className="font-display text-2xl font-bold text-ink mb-4">{activeVideo.title}</h1>
                <VkVideoEmbed vkVideoUrl={activeVideo.vkVideoUrl} title={activeVideo.title} />
                {relatedArticle && (
                  <button
                    onClick={() => select({ kind: 'article', slug: relatedArticle.slug })}
                    className="mt-4 text-sm font-sans text-amber hover:underline"
                  >
                    Читать подробнее в статье «{relatedArticle.title}» →
                  </button>
                )}
              </>
            )}

            {!activeArticle && !activeVideo && (
              <p className="font-sans text-sm text-ink-tertiary">Выберите статью или видео слева.</p>
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
