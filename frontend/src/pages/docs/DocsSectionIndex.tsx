import { Link, Navigate, useParams } from 'react-router-dom'
import manifest from '../../generated/docs/manifest.json'
import type { DocsSection } from '../../lib/docsTypes'
import { useDocMeta } from '../../lib/useDocMeta'

const sections = manifest as DocsSection[]

export default function DocsSectionIndex() {
  const { section: sectionSlug } = useParams()
  const section = sections.find((s) => s.slug === sectionSlug)

  useDocMeta(section?.title ?? 'Документация', section?.description ?? '')

  if (!section) return <Navigate to="/docs" replace />

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-3">{section.title}</h1>
      <p className="text-ink-secondary mb-10 max-w-[600px]">{section.description}</p>

      {section.articles.length === 0 ? (
        <p className="text-sm text-ink-secondary">Статьи этого раздела скоро появятся.</p>
      ) : (
        <div className="space-y-3">
          {section.articles.map((article) => (
            <Link
              key={article.slug}
              to={`/docs/${section.slug}/${article.slug}`}
              className="block rounded-lg border border-ink/10 bg-white p-5 hover:border-amber/40 hover:shadow-sm transition-all"
            >
              <h2 className="font-semibold mb-1">{article.title}</h2>
              <p className="text-sm text-ink-secondary">{article.description}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
