import { useMemo, useState } from 'react'

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
// and groups results by subject, so finding the right one stays easy at any scale.
const COMPACT_THRESHOLD = 6

export default function TemplatePicker({ items, subjectLabel, onPick, title = 'Начать с готового шаблона' }: Props) {
  const [q, setQ] = useState('')
  const [subject, setSubject] = useState<string>('all')

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

  // Many templates — search + subject filter + grouped results.
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
        <FilterPill active={subject === 'all'} onClick={() => setSubject('all')}>Все</FilterPill>
        {subjects.map((s) => (
          <FilterPill key={s} active={subject === s} onClick={() => setSubject(s)}>{labelFor(s)}</FilterPill>
        ))}
      </div>

      {groups.length === 0 ? (
        <p className="text-xs font-sans text-ink-tertiary py-2">Ничего не найдено — измените запрос или фильтр.</p>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.subject}>
              <div className="text-[10px] font-sans font-medium text-ink-tertiary uppercase tracking-wider mb-1.5">
                {labelFor(g.subject)}
              </div>
              <div className="flex flex-wrap gap-2">{g.items.map((it) => chip(it, false))}</div>
            </div>
          ))}
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
