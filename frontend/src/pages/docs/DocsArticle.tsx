import { useEffect, useState } from 'react'
import { Navigate, useParams } from 'react-router-dom'
import manifest from '../../generated/docs/manifest.json'
import type { DocsSection } from '../../lib/docsTypes'
import { useDocMeta } from '../../lib/useDocMeta'

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

  return (
    <article>
      <h1 className="font-display text-3xl font-bold mb-2">{article.title}</h1>
      {article.appliesTo && (
        <p className="text-xs text-ink-tertiary mb-8">Применимо к версии {article.appliesTo}</p>
      )}
      {!article.appliesTo && <div className="mb-8" />}
      {html ? (
        <div className="docs-article" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="text-sm text-ink-secondary">Загрузка…</p>
      )}
    </article>
  )
}
