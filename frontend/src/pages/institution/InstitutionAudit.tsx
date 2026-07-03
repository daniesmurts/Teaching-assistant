import { useQuery } from '@tanstack/react-query'
import { getAuditLog, type AuditEntry } from '../../api/institution'

const fmt = (d: string) => new Date(d).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

const ROLE_LABEL: Record<string, string> = { admin: 'Администратор', head: 'Руководитель', viewer: 'Наблюдатель' }

function describe(e: AuditEntry): string {
  const meta = e.metadata as {
    invited?: number; skipped?: number
    count?: number; role?: string; unitName?: string
  } | null
  switch (e.action) {
    case 'teacher.invited':         return `Приглашён преподаватель: ${e.target}`
    case 'teacher.bulk_invited':    return `Массовое приглашение: ${meta?.invited ?? 0} отправлено${meta?.skipped ? `, ${meta.skipped} пропущено` : ''}`
    case 'teacher.invite_revoked':  return 'Приглашение отозвано'
    case 'teacher.activated':       return 'Преподаватель активирован'
    case 'teacher.deactivated':     return 'Преподаватель деактивирован'
    case 'criterion.shared_created': return `Создан общий критерий: ${e.target}`
    case 'rubric.shared_created':    return `Создана общая рубрика: ${e.target}`
    case 'org_unit.created':        return `Создано подразделение: ${e.target}`
    case 'org_unit.bulk_created':   return `Добавлено подразделений: ${meta?.count ?? 0} (в «${e.target}»)`
    case 'org_unit.updated':        return `Изменено подразделение: ${e.target}`
    case 'org_unit.deleted':        return `Удалено подразделение: ${e.target}`
    case 'org_member.primary_set':  return `Преподаватель ${e.target} привязан к кафедре «${meta?.unitName ?? '—'}»`
    case 'org_role.granted':        return `Выдана роль «${ROLE_LABEL[meta?.role ?? ''] ?? meta?.role}» на «${meta?.unitName ?? '—'}»: ${e.target}`
    case 'org_role.revoked':        return `Снята роль «${ROLE_LABEL[meta?.role ?? ''] ?? meta?.role}» на «${meta?.unitName ?? '—'}»: ${e.target}`
    case 'auth.register':           return 'Регистрация в системе'
    case 'auth.login':              return 'Вход в систему'
    case 'auth.login_failed':       return 'Неудачная попытка входа'
    case 'auth.password_reset_requested': return 'Запрошен сброс пароля'
    case 'auth.password_reset_completed': return 'Пароль изменён (сброс)'
    default:                        return `${e.action}${e.target ? ` · ${e.target}` : ''}`
  }
}

const ICON: Record<string, string> = {
  'teacher.invited': '✉', 'teacher.bulk_invited': '✉', 'teacher.invite_revoked': '✕',
  'teacher.activated': '✓', 'teacher.deactivated': '⏸',
  'criterion.shared_created': '☰', 'rubric.shared_created': '☰',
  'org_unit.created': '+', 'org_unit.bulk_created': '+',
  'org_unit.updated': '✎', 'org_unit.deleted': '✕',
  'org_member.primary_set': '⌂', 'org_role.granted': '★', 'org_role.revoked': '☆',
  'auth.register': '☺', 'auth.login': '→', 'auth.login_failed': '⚠',
  'auth.password_reset_requested': '⌥', 'auth.password_reset_completed': '⟲',
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
