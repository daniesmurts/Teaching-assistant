import { Link, useLocation } from 'react-router-dom'
import { LEGAL_DOCS } from '../../pages/legal/legalDocs'

export default function LegalSidebar() {
  const { pathname, hash } = useLocation()
  const current = pathname + hash

  return (
    <nav className="md:w-[260px] shrink-0 md:sticky md:top-8 md:self-start">
      <Link
        to="/legal"
        className="block text-xs font-semibold uppercase tracking-wider text-ink-tertiary hover:text-ink transition-colors mb-3"
      >
        Правовые документы
      </Link>
      <ul className="space-y-0.5 border-l border-border">
        {LEGAL_DOCS.map((doc) => {
          const active = current === doc.path
          return (
            <li key={doc.path}>
              <Link
                to={doc.path}
                className={`block -ml-px pl-4 py-1.5 text-sm border-l-2 transition-colors ${
                  active
                    ? 'border-amber text-ink font-medium'
                    : 'border-transparent text-ink-secondary hover:text-ink hover:border-border-mid'
                }`}
              >
                {doc.shortTitle}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
