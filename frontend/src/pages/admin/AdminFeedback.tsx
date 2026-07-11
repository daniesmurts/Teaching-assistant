import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFeedback } from '../../api/admin'
import { HELP_ARTICLES } from '../../data/helpArticles'

const CAT: Record<string, { label: string; cls: string }> = {
  bug:         { label: 'Проблема',       cls: 'bg-danger-bg text-danger' },
  idea:        { label: 'Идея',           cls: 'bg-success-bg text-success' },
  question:    { label: 'Вопрос',         cls: 'bg-info-bg text-info' },
  other:       { label: 'Другое',         cls: 'bg-warning-bg text-warning' },
  help_up:     { label: 'Справка 👍',      cls: 'bg-success-bg text-success' },
  help_down:   { label: 'Справка 👎',      cls: 'bg-danger-bg text-danger' },
  help_search: { label: 'Справка: не найдено', cls: 'bg-info-bg text-info' },
}
const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const articleTitle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug)?.title ?? slug

export default function AdminFeedback() {
  const [filter, setFilter] = useState('')
  const { data: feedback = [], isLoading } = useQuery({ queryKey: ['admin-feedback'], queryFn: () => getFeedback(200) })

  const shown = filter ? feedback.filter((f) => f.category === filter) : feedback

  // Per-article helpfulness, derived client-side from the same feed — no new
  // aggregation endpoint needed at this volume. Sorted worst-first: articles
  // with 👎 are the actionable ones, not the ones with the most 👍.
  const articleStats = useMemo(() => {
    const byArticle = new Map<string, { up: number; down: number }>()
    for (const f of feedback) {
      if (f.category !== 'help_up' && f.category !== 'help_down') continue
      const slug = f.page ?? 'unknown'
      const entry = byArticle.get(slug) ?? { up: 0, down: 0 }
      if (f.category === 'help_up') entry.up++; else entry.down++
      byArticle.set(slug, entry)
    }
    return [...byArticle.entries()]
      .map(([slug, counts]) => ({ slug, title: articleTitle(slug), ...counts }))
      .sort((a, b) => b.down - a.down || b.up - a.up)
  }, [feedback])

  const missedSearches = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of feedback) {
      if (f.category !== 'help_search') continue
      counts.set(f.message, (counts.get(f.message) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
  }, [feedback])

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Отзывы</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">Обратная связь от преподавателей</p>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-2"
          >
            <option value="">Все категории</option>
            {Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {articleStats.length > 0 && (
          <div className="mb-6 bg-surface border border-border rounded-lg p-4">
            <h2 className="font-sans text-sm font-semibold text-ink mb-3">Полезность статей справки</h2>
            <div className="space-y-1.5">
              {articleStats.map((a) => (
                <div key={a.slug} className="flex items-center gap-3 text-sm font-sans">
                  <span className="flex-1 text-ink-secondary truncate">{a.title}</span>
                  <span className="text-success tabular-nums">👍 {a.up}</span>
                  <span className="text-danger tabular-nums">👎 {a.down}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {missedSearches.length > 0 && (
          <div className="mb-6 bg-surface border border-border rounded-lg p-4">
            <h2 className="font-sans text-sm font-semibold text-ink mb-3">Ничего не найдено по запросу</h2>
            <div className="flex flex-wrap gap-2">
              {missedSearches.map(([query, count]) => (
                <span key={query} className="text-xs font-sans px-2 py-1 rounded-md bg-info-bg text-info">
                  «{query}»{count > 1 && <span className="opacity-70"> ×{count}</span>}
                </span>
              ))}
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary py-12 text-center">Загрузка…</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">💬</div>
            <p className="font-sans text-sm text-ink-secondary">Отзывов пока нет.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((f) => {
              const cat = CAT[f.category] ?? CAT.other
              return (
                <div key={f.id} className="bg-surface border border-border rounded-lg p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm ${cat.cls}`}>{cat.label}</span>
                    <span className="text-xs font-sans text-ink-secondary">
                      {f.teacher_name || f.teacher_email || 'Аноним'}
                      {f.teacher_email && <span className="text-ink-tertiary"> · {f.teacher_email}</span>}
                    </span>
                    <span className="text-xs font-sans text-ink-tertiary ml-auto">{fmt(f.created_at)}</span>
                  </div>
                  <p className="text-sm font-sans text-ink leading-relaxed whitespace-pre-wrap">{f.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    {f.page && (f.category === 'help_up' || f.category === 'help_down') ? (
                      <span className="text-[11px] font-sans text-ink-tertiary">статья: {articleTitle(f.page)}</span>
                    ) : f.page && f.category !== 'help_search' ? (
                      <span className="text-[11px] font-sans text-ink-tertiary">стр. {f.page}</span>
                    ) : null}
                    {f.teacher_email && (
                      <a href={`mailto:${f.teacher_email}`} className="text-[11px] font-sans text-amber hover:underline">Ответить</a>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
