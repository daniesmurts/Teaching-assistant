import { Link } from 'react-router-dom'
import manifest from '../../generated/docs/manifest.json'
import type { DocsSection } from '../../lib/docsTypes'
import { useDocMeta } from '../../lib/useDocMeta'

const sections = manifest as DocsSection[]

export default function DocsIndex() {
  useDocMeta(
    'Документация для ИТ-служб университетов',
    'Интеграция ИСПУМ (SSO, LTI, роли и оргструктура), безопасность и соответствие 152-ФЗ, локальное развёртывание.'
  )

  return (
    <div>
      <h1 className="font-display text-3xl font-bold mb-3">Документация ИСПУМ</h1>
      <p className="text-ink-secondary mb-10 max-w-[600px]">
        Статьи для ИТ-службы, отдела информационной безопасности и закупки —
        как настроить и эксплуатировать ИСПУМ в вашем университете.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {sections.map((section) => (
          <Link
            key={section.slug}
            to={`/docs/${section.slug}`}
            className="block rounded-lg border border-ink/10 bg-white p-5 hover:border-amber/40 hover:shadow-sm transition-all"
          >
            <h2 className="font-semibold mb-1.5">{section.title}</h2>
            <p className="text-sm text-ink-secondary">{section.description}</p>
          </Link>
        ))}
      </div>
    </div>
  )
}
