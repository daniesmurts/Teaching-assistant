import { Outlet, useLocation } from 'react-router-dom'
import Sidebar from './Sidebar'
import EmailVerifyBanner from './EmailVerifyBanner'
import UpgradeModal from '../ui/UpgradeModal'
import { useUIStore } from '../../store/uiStore'
import { useEffect } from 'react'

function ToastContainer() {
  const { toasts, removeToast } = useUIStore()
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-sans border max-w-sm pointer-events-auto ${
            t.type === 'error'
              ? 'bg-danger-bg text-danger border-danger/20'
              : t.type === 'success'
              ? 'bg-success-bg text-success border-success/20'
              : 'bg-surface text-ink border-border'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="opacity-50 hover:opacity-100 text-base leading-none">×</button>
        </div>
      ))}
    </div>
  )
}

export default function AppShell() {
  const { toasts, removeToast, mobileSidebarOpen, setMobileSidebarOpen } = useUIStore()
  const location = useLocation()

  // Auto-dismiss toasts after 4 s
  useEffect(() => {
    if (toasts.length === 0) return
    const id = toasts[0].id
    const timer = setTimeout(() => removeToast(id), 4000)
    return () => clearTimeout(timer)
  }, [toasts, removeToast])

  // Close mobile sidebar on navigation
  useEffect(() => {
    setMobileSidebarOpen(false)
  }, [location.pathname, setMobileSidebarOpen])

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Mobile overlay */}
      {mobileSidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      {/* Sidebar — drawer on mobile, viewport-pinned on desktop.
          `md:sticky md:top-0 md:h-screen` keeps the menu visible while a
          long page (e.g. a 10-slide presentation) scrolls past it. Without
          this the sidebar lives in normal document flow and the user has
          to scroll back to the top to reach navigation. `md:self-start`
          stops the flex container from stretching the sticky element to
          the page's full content height. */}
      <div
        className={`
          fixed inset-y-0 left-0 z-50
          md:sticky md:top-0 md:z-auto md:h-screen md:self-start
          transition-transform duration-300 ease-in-out
          ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
        `}
      >
        <Sidebar onClose={() => setMobileSidebarOpen(false)} />
      </div>

      {/* Main content */}
      <div className="flex flex-col flex-1 min-w-0">
        <EmailVerifyBanner />
        <Outlet />
      </div>

      <ToastContainer />
      <UpgradeModal />
    </div>
  )
}
