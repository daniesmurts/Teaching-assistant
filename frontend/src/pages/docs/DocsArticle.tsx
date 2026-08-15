import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import manifest from '../../generated/docs/manifest.json'
import type { DocsSection } from '../../lib/docsTypes'
import { useDocMeta } from '../../lib/useDocMeta'
import DocsBreadcrumb from './DocsBreadcrumb'

const sections = manifest as DocsSection[]

// Eager would bundle every article into the main chunk; lazy per-file keeps
// each article's HTML out of the bundle until its route is actually visited.
const contentLoaders = import.meta.glob('../../generated/docs/content/**/*.html', {
  query: '?raw',
  import: 'default',
}) as Record<string, () => Promise<string>>

export default function DocsArticle() {
  const { section: sectionSlug, slug } = useParams()
  const section = sections.find((s) => s.slug === sectionSlug)
  const article = section?.articles.find((a) => a.slug === slug)

  const [html, setHtml] = useState<string | null>(null)

  useDocMeta(article?.title ?? 'Документация', article?.description ?? '')

  useEffect(() => {
    setHtml(null)
    if (!sectionSlug || !slug) return
    const path = `../../generated/docs/content/${sectionSlug}/${slug}.html`
    const loader = contentLoaders[path]
    if (!loader) return
    loader().then(setHtml)
  }, [sectionSlug, slug])

  if (!section || !article) return <Navigate to="/docs" replace />

  const hasToc = article.headings.length > 1

  return (
    <div className="lg:flex lg:gap-10 lg:items-start">
      <article className="max-w-[720px]">
        <DocsBreadcrumb
          items={[
            { label: 'Документация', to: '/docs' },
            { label: section.title, to: `/docs/${section.slug}` },
            { label: article.title },
          ]}
        />
        <h1 className="font-display text-3xl font-bold mb-2">{article.title}</h1>
        {article.appliesTo && (
          <p className="text-xs text-ink-tertiary mb-8">Применимо к версии {article.appliesTo}</p>
        )}
        {!article.appliesTo && <div className="mb-8" />}

        {/* On-page contents on mobile/tablet, where the right rail is hidden */}
        {hasToc && (
          <nav aria-label="Содержание статьи" className="lg:hidden mb-8 rounded-lg border border-ink/10 bg-white p-4">
            <p className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-2">Содержание</p>
            <ul className="space-y-1">
              {article.headings.map((h) => (
                <li key={h.id}>
                  <a href={`#${h.id}`} className="text-sm text-ink-secondary hover:text-amber transition-colors">
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {html ? (
          <div className="docs-article" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <p className="text-sm text-ink-secondary">Загрузка…</p>
        )}
      </article>

      {hasToc && (
        <nav aria-label="Содержание статьи" className="hidden lg:block w-[200px] shrink-0 sticky top-12 self-start">
          <p className="text-xs font-semibold text-ink-tertiary uppercase tracking-wide mb-2">На этой странице</p>
          <ul className="space-y-2 border-l border-ink/10 pl-3">
            {article.headings.map((h) => (
              <li key={h.id}>
                <a
                  href={`#${h.id}`}
                  className="block text-sm text-ink-secondary hover:text-amber transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber focus-visible:outline-offset-2 rounded"
                >
                  {h.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </div>
  )
}
