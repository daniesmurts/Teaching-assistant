import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

interface NavItem { icon: string; label: string; to: string }

const NAV: NavItem[] = [
  { icon: '⊞', label: 'Главная',        to: '/dashboard' },
  { icon: '◫', label: 'Курсы',          to: '/courses' },
  { icon: '✦', label: 'Проверка работ', to: '/grading' },
  { icon: '☰', label: 'Критерии',       to: '/rubrics' },
  { icon: '☺', label: 'Студенты',       to: '/students' },
  { icon: '◷', label: 'Журнал',         to: '/history' },
  { icon: '▤', label: 'Презентации',    to: '/presentations' },
  { icon: '◆', label: 'Тариф',          to: '/billing' },
  { icon: '⚙', label: 'Настройки',      to: '/settings' },
  { icon: '?', label: 'Помощь',         to: '/help' },
]

interface Props {
  onClose?: () => void
}

export default function Sidebar({ onClose }: Props) {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()

  const initials = teacher?.name
    ? teacher.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : teacher?.email?.[0]?.toUpperCase() ?? '?'

  const isInstitutionAdmin = teacher?.role === 'institution_admin' || teacher?.role === 'platform_admin'

  function logout() { clearAuth(); navigate('/login') }

  return (
    <aside className="w-[210px] h-full min-h-screen bg-sidebar flex flex-col flex-shrink-0">
      {/* Logo + mobile close */}
      <div className="px-4 py-4 border-b border-white/5 flex items-center justify-between">
        <span className="font-display text-[19px] font-bold text-ink-inverse tracking-tight">
          ИСПУМ
        </span>
        {onClose && (
          <button
            onClick={onClose}
            className="md:hidden text-ink-inv-muted hover:text-ink-inverse transition-colors text-lg leading-none"
            aria-label="Закрыть меню"
          >
            ×
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-2 py-3 space-y-0.5">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to}>
            {({ isActive }) => (
              <div
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                  isActive ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
                }`}
              >
                <span className={`text-sm w-4 text-center select-none ${isActive ? 'text-amber-mid' : 'text-ink-inv-muted'}`}>
                  {item.icon}
                </span>
                <span className={`text-sm font-sans ${isActive ? 'font-medium text-ink-inverse' : 'font-normal text-ink-inv-muted'}`}>
                  {item.label}
                </span>
              </div>
            )}
          </NavLink>
        ))}

        {/* Feedback — visually distinct (amber) so early users notice it */}
        <NavLink to="/feedback">
          {({ isActive }) => (
            <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors mt-2 border ${
              isActive
                ? 'bg-amber/20 border-amber-mid/40'
                : 'bg-amber/10 border-amber-mid/25 hover:bg-amber/20'
            }`}>
              <span className="text-sm w-4 text-center select-none text-amber-mid">✉</span>
              <span className="text-sm font-sans font-medium text-amber-mid">Обратная связь</span>
            </div>
          )}
        </NavLink>

        {isInstitutionAdmin && (
          <NavLink to="/institution">
            {({ isActive }) => (
              <div className={`flex items-center gap-2.5 px-3 py-2.5 rounded-md cursor-pointer transition-colors mt-1 border-t border-white/5 pt-3 ${
                isActive ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
              }`}>
                <span className={`text-sm w-4 text-center select-none ${isActive ? 'text-amber-mid' : 'text-ink-inv-muted'}`}>◉</span>
                <span className={`text-sm font-sans ${isActive ? 'font-medium text-ink-inverse' : 'font-normal text-ink-inv-muted'}`}>
                  Организация
                </span>
              </div>
            )}
          </NavLink>
        )}
      </nav>

      {/* Teacher profile */}
      <div className="px-3 py-3 border-t border-white/5 space-y-1">
        <div className="flex items-center gap-2.5 px-1">
          <div className="w-8 h-8 rounded-full bg-amber flex items-center justify-center text-xs font-semibold text-white font-sans flex-shrink-0">
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-sans font-medium text-ink-inverse truncate">
              {teacher?.name ?? teacher?.email}
            </div>
            {teacher?.university && (
              <div className="text-[10px] font-sans text-ink-inv-muted truncate">{teacher.university}</div>
            )}
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-ink-inv-muted hover:bg-sidebar-hover hover:text-ink-inverse transition-colors"
        >
          <span className="text-sm w-4 text-center select-none leading-none">⎋</span>
          <span className="text-sm font-sans">Выйти</span>
        </button>
      </div>
    </aside>
  )
}
