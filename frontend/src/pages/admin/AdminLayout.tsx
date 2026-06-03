import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

const NAV = [
  { to: '/admin',          label: 'Обзор',          end: true },
  { to: '/admin/usage',    label: 'Использование',  end: false },
  { to: '/admin/teachers', label: 'Преподаватели',  end: false },
  { to: '/admin/rubrics',  label: 'Шаблоны рубрик', end: false },
  { to: '/admin/errors',   label: 'Ошибки',         end: false },
]

export default function AdminLayout() {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Admin sidebar — distinct from teacher nav */}
      <aside className="w-[210px] min-h-screen bg-sidebar flex flex-col flex-shrink-0">
        <div className="px-4 py-4 border-b border-white/5">
          <span className="font-display text-[19px] font-bold text-ink-inverse tracking-tight">
            ИСПУМ <span className="text-amber-mid">Admin</span>
          </span>
          <div className="text-[10px] font-sans text-ink-inv-muted mt-0.5 uppercase tracking-wider">
            Платформа
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {NAV.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end}>
              {({ isActive }) => (
                <div className={`px-3 py-2 rounded-md text-sm font-sans transition-colors ${
                  isActive ? 'bg-sidebar-active text-ink-inverse font-medium' : 'text-ink-inv-muted hover:bg-sidebar-hover'
                }`}>
                  {item.label}
                </div>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-white/5 space-y-1">
          <button
            onClick={() => navigate('/dashboard')}
            className="w-full text-left text-xs font-sans text-ink-inv-muted hover:text-ink-inverse transition-colors px-3 py-1.5"
          >
            ← В приложение
          </button>
          <button
            onClick={() => { clearAuth(); navigate('/login') }}
            className="w-full text-left text-xs font-sans text-ink-inv-muted hover:text-ink-inverse transition-colors px-3 py-1.5"
          >
            Выйти ({teacher?.email})
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <Outlet />
      </div>
    </div>
  )
}
