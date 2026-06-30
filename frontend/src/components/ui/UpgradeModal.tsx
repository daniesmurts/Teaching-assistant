import { useState } from 'react'
import { useUIStore } from '../../store/uiStore'
import { createPayment, type PurchasablePlan } from '../../api/payments'

const PRO_FEATURES = [
  'Неограниченная проверка работ',
  'Неограниченные презентации',
  'ИСПУМ улучшается с каждой проверкой',
  'Загрузка документов (PDF, Word, изображения)',
  'Генерация писем с обратной связью',
  'Полная история проверок',
]

export default function UpgradeModal() {
  const { upgradeModalOpen, hideUpgradeModal } = useUIStore()
  const addToast = useUIStore((s) => s.addToast)
  const [plan, setPlan]       = useState<PurchasablePlan>('pro_annual')
  const [loading, setLoading] = useState(false)

  if (!upgradeModalOpen) return null

  async function handlePay() {
    setLoading(true)
    try {
      const { paymentUrl } = await createPayment(plan)
      // Full-page redirect to the T-Bank secure payment form
      window.location.href = paymentUrl
    } catch {
      addToast('Не удалось перейти к оплате. Попробуйте ещё раз.', 'error')
      setLoading(false)
    }
  }

  const optionClass = (p: PurchasablePlan) =>
    `flex flex-col items-center px-3 py-3 rounded-lg text-center transition-colors cursor-pointer border-2 ${
      plan === p ? 'border-amber bg-amber-light' : 'border-border hover:border-amber/40'
    }`

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={loading ? undefined : hideUpgradeModal} />

      <div className="relative bg-surface rounded-xl border border-border max-w-sm w-full p-6 animate-[resultAppear_250ms_ease_forwards]">
        <button
          onClick={hideUpgradeModal}
          disabled={loading}
          className="absolute top-4 right-4 text-ink-tertiary hover:text-ink transition-colors text-lg leading-none disabled:opacity-40"
        >
          ×
        </button>

        <h2 className="font-display text-xl font-bold text-ink mb-1">Перейти на Pro</h2>
        <p className="font-sans text-sm text-ink-secondary mb-5">
          Снимите ограничения и получите полный доступ к ИСПУМ.
        </p>

        <ul className="space-y-2 mb-6">
          {PRO_FEATURES.map((f) => (
            <li key={f} className="flex items-start gap-2.5 text-sm font-sans text-ink">
              <span className="text-success mt-0.5 flex-shrink-0 text-base leading-none">✓</span>
              {f}
            </li>
          ))}
        </ul>

        {/* Plan picker */}
        <div className="grid grid-cols-2 gap-2 mb-4">
          <button type="button" className={optionClass('pro_monthly')} onClick={() => setPlan('pro_monthly')}>
            <span className="font-display text-lg font-bold text-ink">₽990</span>
            <span className="text-xs font-sans text-ink-secondary mt-0.5">в месяц</span>
          </button>
          <button type="button" className={optionClass('pro_annual')} onClick={() => setPlan('pro_annual')}>
            <span className="font-display text-lg font-bold text-amber">₽7 900</span>
            <span className="text-xs font-sans text-amber mt-0.5">в год · −33%</span>
          </button>
        </div>

        <button
          onClick={handlePay}
          disabled={loading}
          className="w-full py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {loading ? 'Переход к оплате…' : 'Перейти к оплате'}
        </button>

        <p className="text-center text-xs font-sans text-ink-tertiary mt-3">
          Безопасная оплата картой через Т-Банк
        </p>
      </div>
    </div>
  )
}
