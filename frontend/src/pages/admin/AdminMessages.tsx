import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getContactMessages, markContactMessageRead } from '../../api/admin'

const TOPIC: Record<string, { label: string; cls: string }> = {
  support:  { label: 'Поддержка', cls: 'bg-info-bg text-info' },
  demo:     { label: 'Демо / ВУЗам', cls: 'bg-amber-light text-amber' },
  research: { label: 'Исследования', cls: 'bg-success-bg text-success' },
  billing:  { label: 'Оплата', cls: 'bg-warning-bg text-warning' },
}
const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function AdminMessages() {
  const [filter, setFilter] = useState('')
  const queryClient = useQueryClient()
  const { data: messages = [], isLoading } = useQuery({ queryKey: ['admin-contact-messages'], queryFn: () => getContactMessages(200) })

  const shown = filter ? messages.filter((m) => m.topic === filter) : messages
  const unreadCount = messages.filter((m) => m.status === 'new').length

  const handleMarkRead = async (id: string) => {
    await markContactMessageRead(id)
    queryClient.invalidateQueries({ queryKey: ['admin-contact-messages'] })
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">
              Обращения {unreadCount > 0 && <span className="text-amber">({unreadCount} новых)</span>}
            </h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">Заявки с публичного сайта — Контакты и Исследования</p>
          </div>
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-2"
          >
            <option value="">Все темы</option>
            {Object.entries(TOPIC).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary py-12 text-center">Загрузка…</div>
        ) : shown.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">📭</div>
            <p className="font-sans text-sm text-ink-secondary">Обращений пока нет.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {shown.map((m) => {
              const topic = TOPIC[m.topic] ?? TOPIC.support
              const isNew = m.status === 'new'
              return (
                <div
                  key={m.id}
                  className={`bg-surface border rounded-lg p-4 ${isNew ? 'border-amber/40' : 'border-border'}`}
                >
                  <div className="flex items-center gap-2 mb-2">
                    {isNew && <span className="w-1.5 h-1.5 rounded-full bg-amber flex-shrink-0" />}
                    <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm ${topic.cls}`}>{topic.label}</span>
                    <span className="text-xs font-sans text-ink-secondary">
                      {m.name} <span className="text-ink-tertiary">· {m.email}</span>
                      {m.organization && <span className="text-ink-tertiary"> · {m.organization}</span>}
                    </span>
                    <span className="text-xs font-sans text-ink-tertiary ml-auto">{fmt(m.created_at)}</span>
                  </div>
                  <p className="text-sm font-sans text-ink leading-relaxed whitespace-pre-wrap">{m.message}</p>
                  <div className="flex items-center gap-3 mt-2">
                    <span className="text-[11px] font-sans text-ink-tertiary">со страницы /{m.source_page}</span>
                    <a href={`mailto:${m.email}`} className="text-[11px] font-sans text-amber hover:underline">Ответить</a>
                    {isNew && (
                      <button
                        onClick={() => handleMarkRead(m.id)}
                        className="text-[11px] font-sans text-ink-tertiary hover:text-ink hover:underline ml-auto"
                      >
                        Отметить прочитанным
                      </button>
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
