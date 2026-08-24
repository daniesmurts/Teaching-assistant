import { useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { isUpdateStale } from '../lib/swUpdateGrace'

// Surfaces the vite-plugin-pwa "new service worker waiting" event as a
// bottom-left card. The SW is registered in 'prompt' mode (vite.config.ts) so
// new versions wait for an explicit reload — avoids wiping unsaved grading
// edits via a silent mid-session reload. Periodic update check below catches
// deploys that land while a tab is sitting open all day.
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000   // 10 min

// A dismissed prompt used to mean "forever" — a waiting service worker never
// self-activates while any tab stays open, so a user who clicked "Позже"
// (or a pinned tab that's never in focus long enough to even show the
// prompt) could silently run a stale build indefinitely. This is why some
// users don't see a deploy: dismissal isn't the same as "resolved."
//
// Fix: track when this pending update was first seen (persisted, so it
// survives reloads/tab reopens) and escalate to a non-dismissible banner
// once GRACE_MS has passed, regardless of an earlier dismissal.
const FIRST_SEEN_KEY = 'ga_sw_update_first_seen_at'
const TICK_MS = 60 * 1000   // re-check the grace threshold once a minute while a prompt is live

export default function NewVersionToast() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return
      setInterval(() => {
        // Skip when the tab is hidden — checking while the user isn't looking
        // wastes a request and we'd surface the prompt next time they focus
        // the tab anyway because the SW broadcasts on activation.
        if (document.visibilityState === 'visible') registration.update().catch(() => {})
      }, UPDATE_CHECK_INTERVAL_MS)
    },
  })

  const [dismissed, setDismissed] = useState(false)
  // Forces a re-render every TICK_MS so the grace-period check below is
  // re-evaluated even if nothing else changes (the tab can sit open for
  // the full 24h with no other state transition to trigger a re-render).
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!needRefresh) {
      localStorage.removeItem(FIRST_SEEN_KEY)
      return
    }
    if (!localStorage.getItem(FIRST_SEEN_KEY)) {
      localStorage.setItem(FIRST_SEEN_KEY, String(Date.now()))
    }
    const id = setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => clearInterval(id)
  }, [needRefresh])

  if (!needRefresh) return null

  const firstSeenAt = Number(localStorage.getItem(FIRST_SEEN_KEY) ?? Date.now())
  const isStale = isUpdateStale(firstSeenAt, Date.now())

  if (dismissed && !isStale) return null

  function reload() {
    localStorage.removeItem(FIRST_SEEN_KEY)
    updateServiceWorker(true)
  }

  return (
    <div
      role="status" aria-live="polite"
      className="fixed bottom-4 left-4 z-50 w-[320px] bg-surface border border-border rounded-lg p-4 result-appear"
      style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className={`text-[10px] font-sans font-semibold uppercase tracking-wider rounded-sm px-2 py-0.5 border ${
          isStale ? 'text-danger bg-danger-bg border-danger/20' : 'text-amber bg-amber-light border-amber/20'
        }`}>
          {isStale ? 'Требуется обновление' : 'Обновление'}
        </span>
        {!isStale && (
          <button
            onClick={() => setDismissed(true)}
            aria-label="Закрыть"
            className="text-ink-tertiary hover:text-ink transition-colors leading-none -mt-0.5"
          >
            ×
          </button>
        )}
      </div>
      <div className="font-display text-base font-bold text-ink mt-2.5 leading-tight">
        Доступна новая версия ИСПУМ
      </div>
      <p className="text-xs font-sans text-ink-secondary mt-1.5 leading-relaxed">
        {isStale
          ? 'Эта версия устарела больше суток назад. Пожалуйста, обновите страницу, чтобы продолжить работу — несохранённые изменения могут быть потеряны.'
          : 'Перезагрузите страницу, чтобы продолжить работу с актуальной версией. Несохранённые изменения могут быть потеряны.'}
      </p>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={reload}
          className="px-3 py-1.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Обновить
        </button>
        {!isStale && (
          <button
            onClick={() => setDismissed(true)}
            className="px-2 py-1.5 text-xs font-sans text-ink-secondary hover:text-ink transition-colors"
          >
            Позже
          </button>
        )}
      </div>
    </div>
  )
}
