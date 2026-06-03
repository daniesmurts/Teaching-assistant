import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import { usePlan } from '../hooks/usePlan'
import { useAuthStore } from '../store/authStore'
import { useUIStore } from '../store/uiStore'
import { getPaymentHistory } from '../api/payments'

const PLAN_LABEL: Record<string, string> = {
  pro_monthly: 'Pro — месяц',
  pro_annual:  'Pro — год',
}

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'оплачен',  cls: 'bg-success-bg text-success' },
  pending:   { label: 'в обработке', cls: 'bg-warning-bg text-warning' },
  rejected:  { label: 'отклонён', cls: 'bg-danger-bg text-danger' },
}

function fmtDate(d: string | null) {
  return d ? new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

export default function Billing() {
  const plan = useAuthStore((s) => s.plan)
  const { tier, isFree, gradesUsed, gradesLimit, presentationsUsed, presentationsLimit } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)

  const { data: history = [] } = useQuery({ queryKey: ['payment-history'], queryFn: getPaymentHistory })

  const expiresAt = plan?.expiresAt ? new Date(plan.expiresAt) : null
  const daysLeft  = expiresAt ? Math.max(0, Math.ceil((expiresAt.getTime() - Date.now()) / 86400000)) : null

  const tierName = tier === 'pro' ? 'Pro' : tier === 'institution' ? 'Institution' : 'Бесплатный'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Тариф и оплата" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">

          {/* Current plan card */}
          <div className={`rounded-xl border p-6 mb-6 ${tier === 'free' ? 'bg-surface border-border' : 'bg-amber-light border-amber/30'}`}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs font-sans font-semibold uppercase tracking-wider text-ink-tertiary mb-1">
                  Текущий тариф
                </div>
                <div className="font-display text-3xl font-bold text-ink leading-none">
                  ИСПУМ {tierName}
                </div>
                {tier !== 'free' && expiresAt && (
                  <div className="text-sm font-sans text-ink-secondary mt-2">
                    Активен до <strong className="text-ink">{fmtDate(plan?.expiresAt ?? null)}</strong>
                    {daysLeft !== null && <span className="text-ink-tertiary"> · осталось {daysLeft} дн.</span>}
                  </div>
                )}
              </div>
              <button
                onClick={() => showUpgradeModal()}
                className="px-4 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity flex-shrink-0"
              >
                {isFree ? 'Перейти на Pro' : 'Продлить'}
              </button>
            </div>
          </div>

          {/* Free-tier usage */}
          {isFree && (
            <div className="grid grid-cols-2 gap-3 mb-8">
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-sans text-ink-secondary mb-1">Проверок в этом месяце</div>
                <div className="font-display text-2xl font-bold text-ink">
                  {gradesUsed} <span className="text-base text-ink-tertiary font-sans">/ {gradesLimit}</span>
                </div>
              </div>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-sans text-ink-secondary mb-1">Презентаций в этом месяце</div>
                <div className="font-display text-2xl font-bold text-ink">
                  {presentationsUsed} <span className="text-base text-ink-tertiary font-sans">/ {presentationsLimit}</span>
                </div>
              </div>
            </div>
          )}

          {/* Payment history */}
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
            История платежей
          </div>
          <div className="bg-surface border border-border rounded-lg overflow-hidden">
            {history.length === 0 ? (
              <div className="px-4 py-10 text-center text-sm font-sans text-ink-tertiary">
                Платежей пока нет.
              </div>
            ) : (
              <table className="w-full text-sm font-sans">
                <thead>
                  <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                    <th className="text-left px-4 py-2 font-medium">Дата</th>
                    <th className="text-left px-4 py-2 font-medium">Тариф</th>
                    <th className="text-right px-4 py-2 font-medium">Сумма</th>
                    <th className="text-right px-4 py-2 font-medium">Статус</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((p) => {
                    const badge = STATUS_BADGE[p.status] ?? STATUS_BADGE.pending
                    return (
                      <tr key={p.order_id} className="border-b border-border last:border-0">
                        <td className="px-4 py-2.5 text-ink">{fmtDate(p.created_at)}</td>
                        <td className="px-4 py-2.5 text-ink">{PLAN_LABEL[p.plan] ?? p.plan}</td>
                        <td className="px-4 py-2.5 text-right text-ink">{(p.amount_kopecks / 100).toLocaleString('ru-RU')} ₽</td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-sm ${badge.cls}`}>{badge.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          <p className="text-xs font-sans text-ink-tertiary mt-4 leading-relaxed">
            Оплата производится через Т-Банк. Чек об оплате (54-ФЗ) отправляется на ваш адрес электронной почты.
            По вопросам оплаты: <a href="mailto:support@ispum.ru" className="text-amber hover:underline">support@ispum.ru</a>
          </p>
        </div>
      </div>
    </div>
  )
}
