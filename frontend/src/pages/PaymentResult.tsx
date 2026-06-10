import { useEffect, useState, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { getPaymentStatus } from '../api/payments'
import { getMe } from '../api/auth'
import { useAuthStore } from '../store/authStore'
import SuccessMark from '../components/ui/SuccessMark'

type View = 'checking' | 'success' | 'pending' | 'failed' | 'error'

export default function PaymentResult() {
  const [params]   = useSearchParams()
  const orderId    = params.get('order') ?? ''
  const [view, setView] = useState<View>(orderId ? 'checking' : 'error')
  const updatePlan = useAuthStore((s) => s.updatePlan)
  const cancelled  = useRef(false)

  useEffect(() => {
    if (!orderId) return
    cancelled.current = false

    // Poll status — the webhook may take a few seconds to land server-side.
    let attempts = 0
    const maxAttempts = 12 // ~24s at 2s interval

    async function poll() {
      attempts++
      try {
        const { status } = await getPaymentStatus(orderId)

        if (status === 'confirmed') {
          // Refresh plan from the server so the whole app sees Pro immediately
          try {
            const { plan } = await getMe()
            updatePlan(plan)
          } catch { /* non-fatal */ }
          if (!cancelled.current) setView('success')
          return
        }
        if (status === 'rejected') {
          if (!cancelled.current) setView('failed')
          return
        }
        // still pending
        if (attempts >= maxAttempts) {
          if (!cancelled.current) setView('pending')
          return
        }
        setTimeout(poll, 2000)
      } catch {
        if (!cancelled.current) setView('error')
      }
    }

    poll()
    return () => { cancelled.current = true }
  }, [orderId, updatePlan])

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="font-display text-3xl font-bold text-ink tracking-tight mb-8">ИСПУМ</h1>

        <div className="bg-surface border border-border rounded-lg p-8">
          {view === 'checking' && (
            <>
              <div className="text-4xl mb-3 animate-pulse">⏳</div>
              <h2 className="font-sans text-sm font-medium text-ink mb-2">Проверяем платёж…</h2>
              <p className="font-sans text-sm text-ink-secondary">Это займёт несколько секунд.</p>
            </>
          )}

          {view === 'success' && (
            <>
              <SuccessMark tone="amber" />
              <h2 className="font-display text-xl font-bold text-ink mb-2">Добро пожаловать в Pro!</h2>
              <p className="font-sans text-sm text-ink-secondary mb-5">
                Оплата прошла успешно. Все возможности ИСПУМ Pro теперь доступны.
              </p>
              <Link to="/dashboard" className="inline-block px-5 py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity">
                Перейти в кабинет
              </Link>
            </>
          )}

          {view === 'pending' && (
            <>
              <div className="text-4xl mb-3">⏳</div>
              <h2 className="font-sans text-sm font-medium text-ink mb-2">Платёж обрабатывается</h2>
              <p className="font-sans text-sm text-ink-secondary mb-5">
                Подтверждение может занять до пары минут. Мы активируем Pro автоматически, как только банк подтвердит оплату.
              </p>
              <Link to="/dashboard" className="text-amber text-sm hover:underline">Вернуться в кабинет</Link>
            </>
          )}

          {view === 'failed' && (
            <>
              <div className="text-4xl mb-3">⚠️</div>
              <h2 className="font-sans text-sm font-medium text-ink mb-2">Платёж не прошёл</h2>
              <p className="font-sans text-sm text-ink-secondary mb-5">
                Оплата была отклонена или отменена. Средства не списаны — попробуйте ещё раз.
              </p>
              <Link to="/dashboard" className="text-amber text-sm hover:underline">Вернуться в кабинет</Link>
            </>
          )}

          {view === 'error' && (
            <>
              <div className="text-4xl mb-3">❓</div>
              <h2 className="font-sans text-sm font-medium text-ink mb-2">Не удалось проверить платёж</h2>
              <p className="font-sans text-sm text-ink-secondary mb-5">
                Если средства были списаны, Pro активируется автоматически. Иначе попробуйте снова из кабинета.
              </p>
              <Link to="/dashboard" className="text-amber text-sm hover:underline">Вернуться в кабинет</Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
