import { useQuery } from '@tanstack/react-query'
import { getAuditLog, type AuditEntry } from '../../api/institution'

const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function describe(e: AuditEntry): string {
  const meta = e.metadata as { invited?: number; skipped?: number } | null
  switch (e.action) {
    case 'teacher.invited':         return `Приглашён преподаватель: ${e.target}`
    case 'teacher.bulk_invited':    return `Массовое приглашение: ${meta?.invited ?? 0} отправлено${meta?.skipped ? `, ${meta.skipped} пропущено` : ''}`
    case 'teacher.invite_revoked':  return 'Приглашение отозвано'
    case 'teacher.activated':       return 'Преподаватель активирован'
    case 'teacher.deactivated':     return 'Преподаватель деактивирован'
    case 'rubric.shared_created':   return `Создана общая рубрика: ${e.target}`
    default:                        return `${e.action}${e.target ? ` · ${e.target}` : ''}`
  }
}

const ICON: Record<string, string> = {
  'teacher.invited': '✉', 'teacher.bulk_invited': '✉', 'teacher.invite_revoked': '✕',
  'teacher.activated': '✓', 'teacher.deactivated': '⏸', 'rubric.shared_created': '☰',
}

export default function InstitutionAudit() {
  const { data: entries = [], isLoading } = useQuery({ queryKey: ['inst-audit'], queryFn: getAuditLog })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-1">Журнал действий</h1>
        <p className="text-xs font-sans text-ink-tertiary mb-6">Действия администраторов вашей организации</p>

        {isLoading ? (
          <div className="text-sm font-sans text-ink-tertiary py-12 text-center">Загрузка…</div>
        ) : entries.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-4xl mb-3">🗒️</div>
            <p className="font-sans text-sm text-ink-secondary">Пока нет записей.</p>
          </div>
        ) : (
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            {entries.map((e, i, arr) => (
              <div key={e.id} className={`flex items-start gap-3 px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                <span className="text-ink-tertiary text-sm w-4 text-center flex-shrink-0 mt-0.5">{ICON[e.action] ?? '·'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-sans text-ink">{describe(e)}</div>
                  <div className="text-xs font-sans text-ink-tertiary mt-0.5">{e.actor_email ?? '—'}</div>
                </div>
                <span className="text-xs font-sans text-ink-tertiary flex-shrink-0">{fmt(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
