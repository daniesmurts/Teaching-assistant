import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPaymentsSummary, getAdminPayments } from '../../api/admin'

// Business metrics — who paid when, which charges passed/failed, renewal
// health. Data comes straight from the payments table + teachers grace state.

const PAGE_SIZE = 50

const STATUS_LABEL: Record<string, { label: string; cls: string }> = {
  confirmed: { label: 'Оплачен',   cls: 'bg-green-100 text-green-800' },
  pending:   { label: 'Ожидает',   cls: 'bg-amber-light text-amber' },
  rejected:  { label: 'Отклонён',  cls: 'bg-red-100 text-red-700' },
  refunded:  { label: 'Возврат',   cls: 'bg-gray-200 text-gray-700' },
}

const PLAN_LABEL: Record<string, string> = {
  pro_monthly: 'Pro · месяц',
  pro_annual:  'Pro · год',
}

function rub(kopecks: number): string {
  return `${(kopecks / 100).toLocaleString('ru-RU')} ₽`
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function fmtMonth(ym: string): string {
  return new Date(`${ym}-01`).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })
}

export default function AdminPayments() {
  const [status, setStatus] = useState<string>('')
  const [page, setPage] = useState(0)

  const { data: summaryData } = useQuery({ queryKey: ['admin-payments-summary'], queryFn: () => getPaymentsSummary() })
  const { data: payments } = useQuery({
    queryKey: ['admin-payments', status, page],
    queryFn: () => getAdminPayments({ status: status || undefined, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
  })

  const s = summaryData?.summary
  const totalPages = payments ? Math.max(1, Math.ceil(payments.total / PAGE_SIZE)) : 1

  const filterClass = (v: string) =>
    `px-4 py-2 text-sm font-sans font-medium rounded-md transition-colors ${
      status === v ? 'bg-amber text-white' : 'text-ink-secondary hover:bg-surface-warm'
    }`

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl font-bold text-ink">Платежи</h1>
          {s && (
            <div className="text-right">
              <div className="text-sm font-sans text-ink-tertiary mb-0.5">Выручка в этом месяце</div>
              <div className="font-display text-3xl font-bold text-amber">{rub(s.revenue_this_month_kopecks)}</div>
            </div>
          )}
        </div>

        {/* Summary cards */}
        {s && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="text-sm font-sans text-ink-tertiary">Выручка за 30 дней</div>
              <div className="font-display text-xl font-bold text-ink mt-1">{rub(s.revenue_30d_kopecks)}</div>
              <div className="text-sm font-sans text-ink-secondary mt-0.5">{s.confirmed_30d} платежей</div>
            </div>
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="text-sm font-sans text-ink-tertiary">Активные подписки</div>
              <div className="font-display text-xl font-bold text-ink mt-1">{s.active_subscribers}</div>
              <div className="text-sm font-sans text-ink-secondary mt-0.5">автопродление включено</div>
            </div>
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="text-sm font-sans text-ink-tertiary">Неудачных списаний (30 дн)</div>
              <div className={`font-display text-xl font-bold mt-1 ${s.rejected_30d > 0 ? 'text-red-600' : 'text-ink'}`}>{s.rejected_30d}</div>
              <div className="text-sm font-sans text-ink-secondary mt-0.5">отклонено банком</div>
            </div>
            <div className="bg-surface border border-border rounded-lg p-4">
              <div className="text-sm font-sans text-ink-tertiary">В грейс-периоде</div>
              <div className={`font-display text-xl font-bold mt-1 ${s.in_grace > 0 ? 'text-red-600' : 'text-ink'}`}>{s.in_grace}</div>
              <div className="text-sm font-sans text-ink-secondary mt-0.5">продление не прошло</div>
            </div>
          </div>
        )}

        {/* Monthly revenue */}
        {(summaryData?.byMonth ?? []).length > 0 && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6">
            <div className="text-base font-sans font-medium text-ink mb-4">Выручка по месяцам</div>
            <table className="w-full text-sm font-sans">
              <thead><tr className="border-b border-border">
                <th className="text-left py-2 text-ink-secondary font-medium">Месяц</th>
                <th className="text-right py-2 text-ink-secondary font-medium">Выручка</th>
                <th className="text-right py-2 text-ink-secondary font-medium">Оплачено</th>
                <th className="text-right py-2 text-ink-secondary font-medium">Отклонено</th>
              </tr></thead>
              <tbody>
                {summaryData!.byMonth.map((m) => (
                  <tr key={m.month} className="border-b border-border last:border-0">
                    <td className="py-2 text-ink capitalize">{fmtMonth(m.month)}</td>
                    <td className="py-2 text-right font-medium text-ink">{rub(m.revenue_kopecks)}</td>
                    <td className="py-2 text-right text-ink">{m.confirmed_count}</td>
                    <td className={`py-2 text-right ${m.rejected_count > 0 ? 'text-red-600' : 'text-ink-secondary'}`}>{m.rejected_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Status filter */}
        <div className="flex gap-1 mb-4">
          <button className={filterClass('')}          onClick={() => { setStatus(''); setPage(0) }}>Все</button>
          <button className={filterClass('confirmed')} onClick={() => { setStatus('confirmed'); setPage(0) }}>Оплаченные</button>
          <button className={filterClass('rejected')}  onClick={() => { setStatus('rejected'); setPage(0) }}>Отклонённые</button>
          <button className={filterClass('pending')}   onClick={() => { setStatus('pending'); setPage(0) }}>Ожидающие</button>
          <button className={filterClass('refunded')}  onClick={() => { setStatus('refunded'); setPage(0) }}>Возвраты</button>
        </div>

        {/* Payments table */}
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm font-sans">
            <thead><tr className="border-b border-border bg-surface-warm">
              <th className="text-left px-4 py-3 text-ink-secondary font-medium">Дата</th>
              <th className="text-left px-4 py-3 text-ink-secondary font-medium">Преподаватель</th>
              <th className="text-left px-4 py-3 text-ink-secondary font-medium">Тариф</th>
              <th className="text-left px-4 py-3 text-ink-secondary font-medium">Тип</th>
              <th className="text-right px-4 py-3 text-ink-secondary font-medium">Сумма</th>
              <th className="text-left px-4 py-3 text-ink-secondary font-medium">Статус</th>
            </tr></thead>
            <tbody>
              {(payments?.rows ?? []).map((p) => {
                const st = STATUS_LABEL[p.status] ?? { label: p.status, cls: 'bg-gray-200 text-gray-700' }
                return (
                  <tr key={p.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-ink whitespace-nowrap">{fmtDateTime(p.created_at)}</td>
                    <td className="px-4 py-3">
                      <div className="text-ink font-medium">{p.teacher_name || '—'}</div>
                      <div className="text-ink-tertiary text-[13px] mt-0.5">{p.teacher_email}</div>
                    </td>
                    <td className="px-4 py-3 text-ink">{PLAN_LABEL[p.plan] ?? p.plan}</td>
                    <td className="px-4 py-3 text-ink-secondary">{p.is_renewal ? 'Продление' : 'Покупка'}</td>
                    <td className="px-4 py-3 text-right font-medium text-ink">{rub(p.amount_kopecks)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-[13px] font-medium ${st.cls}`}>{st.label}</span>
                    </td>
                  </tr>
                )
              })}
              {(payments?.rows ?? []).length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-tertiary">Платежей нет</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between mt-4 text-sm font-sans">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => p - 1)}
              className="px-4 py-2 rounded-md border border-border text-ink disabled:opacity-40"
            >← Назад</button>
            <span className="text-ink-secondary">Стр. {page + 1} из {totalPages} · всего {payments?.total}</span>
            <button
              disabled={page + 1 >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              className="px-4 py-2 rounded-md border border-border text-ink disabled:opacity-40"
            >Вперёд →</button>
          </div>
        )}
      </div>
    </div>
  )
}
