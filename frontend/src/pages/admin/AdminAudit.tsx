import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { getAudit, type AuditEntry } from '../../api/admin'

const PAGE = 100

const fmt = (d: string) =>
  new Date(d).toLocaleString('ru-RU', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })

// Resource segment → Russian label for the auto-derived `resource.verb` actions.
const RESOURCE_LABEL: Record<string, string> = {
  courses:       'Курс',
  rubrics:       'Рубрика',
  criteria:      'Критерий',
  grading:       'Проверка',
  presentations: 'Презентация',
  documents:     'Документ',
  topics:        'Тема',
  tasks:         'Задание',
  quizzes:       'Тест',
  curriculum:    'Учебный план',
  feedback:      'Отзыв',
  account:       'Аккаунт',
  payments:      'Оплата',
  institution:   'Организация',
}

const VERB_LABEL: Record<string, string> = {
  create: 'создан(а)', update: 'изменён(а)', delete: 'удалён(а)',
  approve: 'подтверждён(а)', grade: '— проверка', generate: '— генерация', send: 'отправлен(а)',
}

// Auth events carry their own full-phrase labels (they don't fit the
// resource + verb shape and are the security-relevant rows).
const AUTH_LABEL: Record<string, string> = {
  'auth.register':                 'Регистрация',
  'auth.login':                    'Вход в систему',
  'auth.login_failed':             'Неудачная попытка входа',
  'auth.password_reset_requested': 'Запрошен сброс пароля',
  'auth.password_reset_completed': 'Пароль изменён (сброс)',
}

// Human description. Falls back to the raw action for anything unmapped so no
// event is ever unreadable.
function describe(e: AuditEntry): string {
  if (AUTH_LABEL[e.action]) {
    const reason = (e.metadata as { reason?: string } | null)?.reason
    return reason ? `${AUTH_LABEL[e.action]} (${reason})` : AUTH_LABEL[e.action]
  }
  const [resource, verb] = e.action.split('.')
  const rLabel = RESOURCE_LABEL[resource]
  const vLabel = verb ? VERB_LABEL[verb] : undefined
  const base = rLabel && vLabel ? `${rLabel} ${vLabel}` : e.action
  return e.target ? `${base} · ${e.target}` : base
}

export default function AdminAudit() {
  const [action, setAction] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['admin-audit', action, from, to, page],
    queryFn: () =>
      getAudit({
        action: action || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to + 'T23:59:59').toISOString() : undefined,
        limit: PAGE,
        offset: page * PAGE,
      }),
    placeholderData: keepPreviousData,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const maxPage = Math.max(0, Math.ceil(total / PAGE) - 1)

  const resetPage = <T,>(setter: (v: T) => void) => (v: T) => { setter(v); setPage(0) }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-1">Журнал действий</h1>
        <p className="text-xs font-sans text-ink-tertiary mb-6">
          Все действия пользователей на платформе · {total.toLocaleString('ru-RU')} записей
        </p>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Действие</span>
            <input
              value={action}
              onChange={(e) => resetPage(setAction)(e.target.value)}
              placeholder="напр. courses.create"
              className="text-sm font-sans bg-surface border border-border-mid rounded-md px-2.5 py-1.5 w-52 text-ink"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">С даты</span>
            <input type="date" value={from} onChange={(e) => resetPage(setFrom)(e.target.value)}
              className="text-sm font-sans bg-surface border border-border-mid rounded-md px-2.5 py-1.5 text-ink" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">По дату</span>
            <input type="date" value={to} onChange={(e) => resetPage(setTo)(e.target.value)}
              className="text-sm font-sans bg-surface border border-border-mid rounded-md px-2.5 py-1.5 text-ink" />
          </label>
          {(action || from || to) && (
            <button
              onClick={() => { setAction(''); setFrom(''); setTo(''); setPage(0) }}
              className="text-xs font-sans text-ink-secondary hover:bg-surface-warm border border-border-mid rounded-md px-3 py-2 transition-colors"
            >
              Сбросить
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary py-12 text-center">Загрузка…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🗒️</div>
            <p className="font-sans text-sm text-ink-secondary">Записей не найдено.</p>
          </div>
        ) : (
          <div className={`bg-surface border border-border rounded-lg overflow-hidden transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
            {rows.map((e, i) => (
              <div key={e.id} className={`flex items-start gap-3 px-4 py-3 ${i < rows.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-sans text-ink">{describe(e)}</div>
                  <div className="text-xs font-sans text-ink-tertiary mt-0.5 truncate">
                    {e.actor_email ?? '—'}
                    {e.ip_address ? ` · ${e.ip_address}` : ''}
                  </div>
                </div>
                <span className="text-xs font-mono text-ink-tertiary flex-shrink-0">{e.action}</span>
                <span className="text-xs font-sans text-ink-tertiary flex-shrink-0 w-32 text-right">{fmt(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {total > PAGE && (
          <div className="flex items-center justify-between mt-4">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="text-sm font-sans text-ink-secondary disabled:opacity-40 hover:bg-surface-warm border border-border-mid rounded-md px-3 py-1.5 transition-colors"
            >
              ← Назад
            </button>
            <span className="text-xs font-sans text-ink-tertiary">Стр. {page + 1} из {maxPage + 1}</span>
            <button
              disabled={page >= maxPage}
              onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
              className="text-sm font-sans text-ink-secondary disabled:opacity-40 hover:bg-surface-warm border border-border-mid rounded-md px-3 py-1.5 transition-colors"
            >
              Вперёд →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
