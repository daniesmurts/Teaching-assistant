import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getTeacherPayments, grantSubscription, cancelSubscription, refundPayment,
} from '../../api/admin'
import { useUIStore } from '../../store/uiStore'

interface Props {
  teacher: { id: string; name: string | null; email: string; plan_tier: string }
  onClose: () => void
}

const PLAN_LABEL: Record<string, string> = { pro_monthly: 'Pro — месяц', pro_annual: 'Pro — год' }

export default function SubscriptionModal({ teacher, onClose }: Props) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [days, setDays] = useState(30)

  const { data: payments = [] } = useQuery({
    queryKey: ['admin-teacher-payments', teacher.id],
    queryFn: () => getTeacherPayments(teacher.id),
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-teacher-payments', teacher.id] })
    qc.invalidateQueries({ queryKey: ['admin-teachers'] })
  }

  const grantMut = useMutation({
    mutationFn: () => grantSubscription(teacher.id, days),
    onSuccess: () => { invalidate(); addToast(`Выдано ${days} дн. Pro`, 'success') },
    onError:   () => addToast('Не удалось выдать подписку', 'error'),
  })
  const cancelMut = useMutation({
    mutationFn: () => cancelSubscription(teacher.id),
    onSuccess: () => { invalidate(); addToast('Подписка отменена', 'success') },
    onError:   () => addToast('Не удалось отменить подписку', 'error'),
  })
  const refundMut = useMutation({
    mutationFn: (orderId: string) => refundPayment(orderId),
    onSuccess: () => { invalidate(); addToast('Возврат оформлен', 'success') },
    onError:   () => addToast('Не удалось оформить возврат', 'error'),
  })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-surface rounded-xl border border-border max-w-lg w-full p-6 max-h-[85vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-ink-tertiary hover:text-ink text-lg leading-none">×</button>

        <h2 className="font-display text-lg font-bold text-ink mb-1">Управление подпиской</h2>
        <p className="text-sm font-sans text-ink-secondary mb-1">{teacher.name ?? teacher.email}</p>
        <p className="text-xs font-sans text-ink-tertiary mb-5">
          Текущий тариф: <span className="font-medium text-ink">{teacher.plan_tier}</span>
        </p>

        {/* Grant / extend */}
        <div className="bg-surface-warm border border-border rounded-lg p-4 mb-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Выдать / продлить Pro
          </div>
          <div className="flex items-center gap-2 mb-3">
            {[30, 90, 365].map((d) => (
              <button key={d} onClick={() => setDays(d)}
                className={`text-xs px-2.5 py-1 rounded-md border ${days === d ? 'border-amber bg-amber-light text-amber' : 'border-border text-ink-secondary'}`}>
                {d} дн.
              </button>
            ))}
            <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))}
              className="w-20 text-xs px-2 py-1 border border-border rounded-md ml-1" />
          </div>
          <button onClick={() => grantMut.mutate()} disabled={grantMut.isPending}
            className="text-sm px-4 py-2 rounded-md bg-amber text-white font-medium hover:opacity-90 disabled:opacity-60">
            {grantMut.isPending ? 'Выдаём…' : `Выдать ${days} дн. Pro`}
          </button>
          <span className="text-xs text-ink-tertiary ml-2">добавляется к текущему сроку</span>
        </div>

        {/* Cancel */}
        <div className="flex items-center justify-between bg-danger-bg border border-danger/15 rounded-lg p-4 mb-5">
          <div className="text-sm font-sans text-danger">Отменить подписку (сразу на Free)</div>
          <button onClick={() => { if (confirm('Отменить подписку немедленно?')) cancelMut.mutate() }}
            disabled={cancelMut.isPending}
            className="text-sm px-3 py-1.5 rounded-md border border-danger/40 text-danger font-medium hover:bg-danger/5 disabled:opacity-60">
            Отменить
          </button>
        </div>

        {/* Payments + refund */}
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Платежи
        </div>
        <div className="border border-border rounded-lg overflow-hidden">
          {payments.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-ink-tertiary">Платежей нет</div>
          ) : (
            <table className="w-full text-xs font-sans">
              <tbody>
                {payments.map((p) => (
                  <tr key={p.order_id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-ink">{new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
                    <td className="px-3 py-2 text-ink-secondary">{PLAN_LABEL[p.plan] ?? p.plan}</td>
                    <td className="px-3 py-2 text-right text-ink">{(p.amount_kopecks / 100).toLocaleString('ru-RU')} ₽</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded-sm ${
                        p.status === 'confirmed' ? 'bg-success-bg text-success' :
                        p.status === 'refunded' ? 'bg-info-bg text-info' :
                        p.status === 'rejected' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      {p.status === 'confirmed' ? (
                        <button onClick={() => { if (confirm('Оформить полный возврат?')) refundMut.mutate(p.order_id) }}
                          disabled={refundMut.isPending}
                          className="text-amber hover:underline disabled:opacity-50">
                          Возврат
                        </button>
                      ) : <span className="text-ink-tertiary">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <p className="text-[11px] text-ink-tertiary mt-3 leading-relaxed">
          Возврат возвращает деньги через T-Bank, но не отменяет доступ автоматически — при необходимости отмените подписку отдельно.
        </p>
      </div>
    </div>
  )
}
