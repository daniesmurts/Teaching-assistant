import { Link } from 'react-router-dom'

// 3+ level hierarchy (Документация → раздел → статья) — breadcrumbs earn
// their place here per the usual "3+ levels of depth" navigation guideline;
// they'd be noise on a flat page.
export default function DocsBreadcrumb({
  items,
}: {
  items: { label: string; to?: string }[]
}) {
  return (
    <nav aria-label="Хлебные крошки" className="mb-6 text-sm text-ink-secondary">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && <span aria-hidden="true">/</span>}
            {item.to ? (
              <Link
                to={item.to}
                className="hover:text-amber transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber focus-visible:outline-offset-2 rounded"
              >
                {item.label}
              </Link>
            ) : (
              <span className="text-ink" aria-current="page">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
