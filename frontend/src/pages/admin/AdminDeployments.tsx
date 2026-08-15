import { useQuery } from '@tanstack/react-query'
import { getAdminDeployments, type DeploymentSummary } from '../../api/admin'

// §5.5: branch on CONNECTIVITY, not customer type. 45 min = 3× the agent's
// 15-min tick interval — enough slack for one missed tick without flagging
// stale, tight enough that a genuinely quiet deployment gets caught same-day.
const STALE_AFTER_MS = 45 * 60 * 1000

type Connectivity = 'live' | 'stale' | 'offline'

function connectivityOf(d: DeploymentSummary): Connectivity {
  if (d.expected_connectivity === 'offline_export') return 'offline'
  if (!d.last_heartbeat_at) return 'stale'
  const age = Date.now() - new Date(d.last_heartbeat_at).getTime()
  return age <= STALE_AFTER_MS ? 'live' : 'stale'
}

const DOT: Record<Connectivity, string> = { live: 'bg-success', stale: 'bg-warning', offline: 'bg-ink-tertiary' }
const LABEL: Record<Connectivity, string> = { live: 'В сети', stale: 'Нет связи', offline: 'Офлайн (по расписанию)' }

function formatAgo(iso: string | null): string {
  if (!iso) return 'никогда'
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} ч назад`
  return `${Math.floor(hr / 24)} дн назад`
}

function DeploymentCard({ d }: { d: DeploymentSummary }) {
  const connectivity = connectivityOf(d)

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${DOT[connectivity]}`} />
            <span className="font-display text-base font-bold text-ink">{d.name}</span>
          </div>
          <div className="text-xs font-sans text-ink-tertiary mt-0.5">
            {LABEL[connectivity]} · {d.mode} · {d.current_version ?? 'версия неизвестна'}
          </div>
        </div>
        {d.errors_24h > 0 && (
          <span className="text-xs font-sans font-medium text-danger bg-danger-bg rounded-full px-2 py-0.5">
            {d.errors_24h} ошиб. / 24ч
          </span>
        )}
      </div>

      {/* A three-week-old number shown as live is worse than a blank (§5.5) —
          every figure below is only rendered alongside the freshness line it belongs to. */}
      <div className="grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="font-display text-xl font-bold text-ink">{d.active_seats ?? '—'}</div>
          <div className="text-[11px] font-sans text-ink-tertiary">мест активно</div>
        </div>
        <div>
          <div className={`font-display text-xl font-bold ${d.db_ok === false ? 'text-danger' : 'text-ink'}`}>
            {d.db_ok === null ? '—' : d.db_ok ? 'OK' : 'сбой'}
          </div>
          <div className="text-[11px] font-sans text-ink-tertiary">БД</div>
        </div>
        <div>
          <div className="font-display text-xl font-bold text-ink">{d.queue_depth ?? '—'}</div>
          <div className="text-[11px] font-sans text-ink-tertiary">в очереди</div>
        </div>
      </div>

      <div className="text-[11px] font-sans text-ink-tertiary mt-3 pt-3 border-t border-border">
        Последний сигнал: {formatAgo(d.last_heartbeat_at)}
        {d.first_seen_at && ` · Известна с ${new Date(d.first_seen_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`}
      </div>
    </div>
  )
}

export default function AdminDeployments() {
  // 60s refetch — this page IS the freshness signal; it must not itself go stale silently.
  const { data: deployments = [], isLoading } = useQuery({
    queryKey: ['admin-deployments'],
    queryFn:  getAdminDeployments,
    refetchInterval: 60_000,
  })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Развёртывания</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Каждое развёртывание ИСПУМ — наш облачный сервис и будущие локальные установки — присылает подписанный сигнал каждые 15 минут.
          </p>
        </div>

        {isLoading && <div className="text-sm font-sans text-ink-tertiary">Загрузка…</div>}

        {!isLoading && deployments.length === 0 && (
          <div className="text-sm font-sans text-ink-tertiary text-center py-12 bg-surface border border-border rounded-lg">
            Развёртываний пока нет
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {deployments.map((d) => <DeploymentCard key={d.id} d={d} />)}
        </div>
      </div>
    </div>
  )
}
