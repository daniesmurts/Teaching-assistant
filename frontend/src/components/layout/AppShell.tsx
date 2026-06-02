import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import { useUIStore } from '../../store/uiStore'
import { useEffect } from 'react'

function ToastContainer() {
  const { toasts, removeToast } = useUIStore()

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-sm text-sm font-sans border max-w-sm ${
            t.type === 'error'
              ? 'bg-danger-bg text-danger border-danger/20'
              : t.type === 'success'
              ? 'bg-success-bg text-success border-success/20'
              : 'bg-surface text-ink border-border'
          }`}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => removeToast(t.id)} className="opacity-50 hover:opacity-100 text-base">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

export default function AppShell() {
  const { toasts, removeToast } = useUIStore()

  // Auto-dismiss toasts after 4 s
  useEffect(() => {
    if (toasts.length === 0) return
    const id = toasts[0].id
    const timer = setTimeout(() => removeToast(id), 4000)
    return () => clearTimeout(timer)
  }, [toasts, removeToast])

  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Outlet />
      </div>
      <ToastContainer />
    </div>
  )
}
