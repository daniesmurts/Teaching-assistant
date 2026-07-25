import { useEffect, useMemo, useState } from 'react'

export interface TemplateItem {
  id:       string
  name:     string
  subject?: string | null
}

interface Props {
  items:        TemplateItem[]
  subjectLabel: Record<string, string>
  onPick:       (item: TemplateItem) => void
  title?:       string
}

// Adaptive "start from a template" picker. A short flat list when there are only a
// few templates; once the list grows it gains a search box + subject-filter pills
// and groups results into collapsible categories, so finding the right one stays
// easy whether there are a dozen templates or several hundred.
const COMPACT_THRESHOLD = 6
const ITEMS_PER_CATEGORY = 12

export default function TemplatePicker({ items, subjectLabel, onPick, title = 'Начать с готового шаблона' }: Props) {
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAllOf, setShowAllOf] = useState<Set<string>>(new Set())

  // Subjects present, in order of first appearance.
  const subjects = useMemo(() => {
    const seen: string[] = []
    for (const it of items) {
      const s = it.subject ?? 'other'
      if (!seen.includes(s)) seen.push(s)
    }
    return seen
  }, [items])

  const labelFor = (s: string) => subjectLabel[s] ?? (s === 'other' ? 'Прочее' : s)

  const searching = q.trim() !== ''

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((it) =>
      (subject === 'all' || (it.subject ?? 'other') === subject) &&
      (needle === '' || it.name.toLowerCase().includes(needle))
    )
  }, [items, q, subject])

  // Group filtered items by subject, preserving the subjects order.
  const groups = useMemo(() => {
    const order = subjects.filter((s) => subject === 'all' || s === subject)
    return order
      .map((s) => ({ subject: s, items: filtered.filter((it) => (it.subject ?? 'other') === s) }))
      .filter((g) => g.items.length > 0)
  }, [filtered, subjects, subject])

  // While searching, or once a specific subject is picked, auto-open the
  // relevant group(s) — collapsing is only useful for the unfiltered "Все" view.
  useEffect(() => {
    if (searching || subject !== 'all') {
      setExpanded(new Set(groups.map((g) => g.subject)))
    }
  }, [searching, subject, groups])

  if (items.length === 0) return null

  const header = (
    <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
      {title}
    </div>
  )

  const chip = (it: TemplateItem, showSubject: boolean) => (
    <button key={it.id} onClick={() => onPick(it)}
      className="px-3 py-1.5 text-xs font-sans bg-surface border border-border rounded-md hover:border-amber/40 hover:bg-amber-light transition-colors">
      {it.name}
      {showSubject && it.subject && (
        <span className="text-ink-tertiary ml-1.5">· {labelFor(it.subject)}</span>
      )}
    </button>
  )

  // Few templates — keep it simple: one flat row.
  if (items.length <= COMPACT_THRESHOLD) {
    return (
      <div className="mb-6">
        {header}
        <div className="flex flex-wrap gap-2">{items.map((it) => chip(it, true))}</div>
      </div>
    )
  }

  const toggleGroup = (s: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  const toggleShowAll = (s: string) => {
    setShowAllOf((prev) => {
      const next = new Set(prev)
      if (next.has(s)) next.delete(s)
      else next.add(s)
      return next
    })
  }

  // Many templates — search + subject filter + collapsible, capped groups.
  return (
    <div className="mb-6">
      {header}

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Поиск шаблона…"
        className="w-full px-3 py-2 mb-2.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
      />

      <div className="flex flex-wrap gap-1.5 mb-3">
        <FilterPill active={subject === 'all'} onClick={() => setSubject('all')}>
          Все <span className="opacity-70">· {items.length}</span>
        </FilterPill>
        {subjects.map((s) => (
          <FilterPill key={s} active={subject === s} onClick={() => setSubject(s)}>
            {labelFor(s)} <span className="opacity-70">· {items.filter((it) => (it.subject ?? 'other') === s).length}</span>
          </FilterPill>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="text-xs font-sans text-ink-tertiary py-2">Ничего не найдено — измените запрос или фильтр.</p>
      ) : (
        <div className="divide-y divide-border border border-border rounded-md overflow-hidden">
          {groups.map((g) => {
            const isOpen = expanded.has(g.subject)
            const showAll = showAllOf.has(g.subject)
            const visibleItems = showAll ? g.items : g.items.slice(0, ITEMS_PER_CATEGORY)
            const hiddenCount = g.items.length - visibleItems.length
            return (
              <div key={g.subject} className="bg-surface">
                <button
                  onClick={() => toggleGroup(g.subject)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2 text-left hover:bg-amber-light/40 transition-colors"
                  aria-expanded={isOpen}
                >
                  <span className="text-xs font-sans font-medium text-ink-secondary">
                    {labelFor(g.subject)}
                    <span className="text-ink-tertiary font-normal ml-1.5">· {g.items.length}</span>
                  </span>
                  <ChevronIcon open={isOpen} />
                </button>

                {isOpen && (
                  <div className="px-3 pb-3 pt-0.5">
                    <div className="flex flex-wrap gap-2">{visibleItems.map((it) => chip(it, false))}</div>
                    {hiddenCount > 0 && (
                      <button
                        onClick={() => toggleShowAll(g.subject)}
                        className="mt-2 text-xs font-sans text-amber hover:underline"
                      >
                        Показать ещё {hiddenCount}
                      </button>
                    )}
                    {showAll && g.items.length > ITEMS_PER_CATEGORY && (
                      <button
                        onClick={() => toggleShowAll(g.subject)}
                        className="mt-2 ml-3 text-xs font-sans text-ink-tertiary hover:underline"
                      >
                        Свернуть
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 text-xs font-sans rounded-full border transition-colors ${
        active
          ? 'bg-amber text-white border-amber'
          : 'bg-surface text-ink-secondary border-border hover:border-amber/40'
      }`}
    >
      {children}
    </button>
  )
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round"
      className={`text-ink-tertiary shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}
