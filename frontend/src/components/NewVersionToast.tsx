import { useRegisterSW } from 'virtual:pwa-register/react'

// Surfaces the vite-plugin-pwa "new service worker waiting" event as a
// bottom-left card. The SW is registered in 'prompt' mode (vite.config.ts) so
// new versions wait for an explicit reload — avoids wiping unsaved grading
// edits via a silent mid-session reload. Periodic update check below catches
// deploys that land while a tab is sitting open all day.
const UPDATE_CHECK_INTERVAL_MS = 10 * 60 * 1000   // 10 min

export default function NewVersionToast() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
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

  if (!needRefresh) return null

  return (
    <div
      role="status" aria-live="polite"
      className="fixed bottom-4 left-4 z-50 w-[320px] bg-surface border border-border rounded-lg p-4 result-appear"
      style={{ boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-amber bg-amber-light border border-amber/20 rounded-sm px-2 py-0.5">
          Обновление
        </span>
        <button
          onClick={() => setNeedRefresh(false)}
          aria-label="Закрыть"
          className="text-ink-tertiary hover:text-ink transition-colors leading-none -mt-0.5"
        >
          ×
        </button>
      </div>
      <div className="font-display text-base font-bold text-ink mt-2.5 leading-tight">
        Доступна новая версия ИСПУМ
      </div>
      <p className="text-xs font-sans text-ink-secondary mt-1.5 leading-relaxed">
        Перезагрузите страницу, чтобы продолжить работу с актуальной версией. Несохранённые изменения могут быть потеряны.
      </p>
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={() => updateServiceWorker(true)}
          className="px-3 py-1.5 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
        >
          Обновить
        </button>
        <button
          onClick={() => setNeedRefresh(false)}
          className="px-2 py-1.5 text-xs font-sans text-ink-secondary hover:text-ink transition-colors"
        >
          Позже
        </button>
      </div>
    </div>
  )
}
