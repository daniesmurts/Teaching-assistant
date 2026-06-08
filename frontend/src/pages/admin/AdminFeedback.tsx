import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getFeedback } from '../../api/admin'

const CAT: Record<string, { label: string; cls: string }> = {
  bug:      { label: 'Проблема', cls: 'bg-danger-bg text-danger' },
  idea:     { label: 'Идея',     cls: 'bg-success-bg text-success' },
  question: { label: 'Вопрос',   cls: 'bg-info-bg text-info' },
  other:    { label: 'Другое',   cls: 'bg-warning-bg text-warning' },
}
const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AdminFeedback() {
  const [filter, setFilter] = useState('')
  const { data: feedback = [], isLoading } = useQuery({ queryKey: ['admin-feedback'], queryFn: () => getFeedback(200) })

  const shown = filter ? feedback.filter((f) => f.category === filter) : feedback

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
                    {f.page && <span className="text-[11px] font-sans text-ink-tertiary">стр. {f.page}</span>}
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
