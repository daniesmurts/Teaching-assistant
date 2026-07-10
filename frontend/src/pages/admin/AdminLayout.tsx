import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import Icon from '../../components/ui/Icon'
import type { IconName } from '../../components/ui/Icon'

const NAV: Array<{ to: string; label: string; icon: IconName; end: boolean }> = [
  { to: '/admin',          label: 'Обзор',               icon: 'home',       end: true },
  { to: '/admin/usage',    label: 'Использование',       icon: 'bar-chart',  end: false },
  { to: '/admin/activation', label: 'Активация',         icon: 'play-circle', end: false },
  { to: '/admin/payments', label: 'Платежи',             icon: 'diamond',    end: false },
  { to: '/admin/teachers', label: 'Преподаватели',       icon: 'users',      end: false },
  { to: '/admin/institutions', label: 'Организации',     icon: 'building',   end: false },
  { to: '/admin/rubrics',  label: 'Шаблоны критериев',   icon: 'list-checks', end: false },
  { to: '/admin/rubric-templates', label: 'Шаблоны рубрик', icon: 'list-checks', end: false },
  { to: '/admin/feedback', label: 'Отзывы',              icon: 'mail',       end: false },
  { to: '/admin/messages', label: 'Обращения',           icon: 'mail',       end: false },
  { to: '/admin/errors',   label: 'Ошибки',              icon: 'shield',     end: false },
  { to: '/admin/audit',    label: 'Журнал действий',     icon: 'clock',      end: false },
  { to: '/admin/evals',    label: 'Эксперименты',        icon: 'sparkle',    end: false },
]

export default function AdminLayout() {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Admin sidebar — distinct from teacher nav */}
      <aside className="w-[210px] h-screen sticky top-0 self-start bg-sidebar flex flex-col flex-shrink-0">
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
                <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-sans transition-colors ${
                  isActive ? 'bg-sidebar-active text-ink-inverse font-medium' : 'text-ink-inv-muted hover:bg-sidebar-hover'
                }`}>
                  <Icon
                    name={item.icon}
                    className={`flex-shrink-0 ${isActive ? 'text-amber-mid' : ''}`}
                  />
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
