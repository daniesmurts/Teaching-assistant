import { NavLink, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'
import Icon, { type IconName } from '../ui/Icon'
import { initialsForAvatar } from '../../lib/teacherName'

interface NavItem { icon: IconName; label: string; to: string }
interface NavGroup { label?: string; items: NavItem[] }

// Grouped by what the teacher is trying to do — top to bottom: overview →
// grading → AI generation → setup → account.
const NAV_GROUPS: NavGroup[] = [
  { items: [
    { icon: 'home',         label: 'Главная',        to: '/dashboard' },
  ]},
  { label: 'Проверка', items: [
    { icon: 'sparkle',      label: 'Проверка работ', to: '/grading' },
    { icon: 'clock',        label: 'Журнал',         to: '/history' },
    { icon: 'users',        label: 'Студенты',       to: '/students' },
  ]},
  { label: 'Генерация', items: [
    { icon: 'presentation', label: 'Презентации',    to: '/presentations' },
    { icon: 'lightbulb',    label: 'Темы',           to: '/topics' },
    { icon: 'quiz',         label: 'Тесты',          to: '/quizzes' },
  ]},
  { label: 'Управление', items: [
    { icon: 'book',         label: 'Предметы',       to: '/courses' },
    { icon: 'list-checks',  label: 'Критерии',       to: '/criteria' },
    { icon: 'list-checks',  label: 'Рубрики',        to: '/rubrics' },
  ]},
  { label: 'Аккаунт', items: [
    { icon: 'diamond',      label: 'Тариф',          to: '/billing' },
    { icon: 'settings',     label: 'Настройки',      to: '/settings' },
    { icon: 'help-circle',  label: 'Помощь',         to: '/help' },
  ]},
]

function NavRow({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to}>
      {({ isActive }) => (
        <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors ${
          isActive ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
        }`}>
          <Icon
            name={item.icon}
            className={`flex-shrink-0 ${isActive ? 'text-amber-mid' : 'text-ink-inv-muted'}`}
          />
          <span className={`text-sm font-sans ${isActive ? 'font-medium text-ink-inverse' : 'font-normal text-ink-inv-muted'}`}>
            {item.label}
          </span>
        </div>
      )}
    </NavLink>
  )
}

interface Props {
  onClose?: () => void
}

export default function Sidebar({ onClose }: Props) {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()

  const initials =
    initialsForAvatar(teacher?.name) || teacher?.email?.[0]?.toUpperCase() || '?'

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

      {/* Nav — grouped into labeled sections */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
            {group.label && (
              <div className="px-3 pb-1 text-[10px] font-sans font-semibold uppercase tracking-wider text-amber-mid">
                {group.label}
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => <NavRow key={item.to} item={item} />)}
            </div>
          </div>
        ))}

        {/* Feedback — visually distinct (amber) so early users notice it */}
        <NavLink to="/feedback">
          {({ isActive }) => (
            <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors mt-3 border ${
              isActive
                ? 'bg-amber/20 border-amber-mid/40'
                : 'bg-amber/10 border-amber-mid/25 hover:bg-amber/20'
            }`}>
              <Icon name="mail" className="flex-shrink-0 text-amber-mid" />
              <span className="text-sm font-sans font-medium text-amber-mid">Обратная связь</span>
            </div>
          )}
        </NavLink>

        {/* Institution admin — only for institution/platform admins */}
        {isInstitutionAdmin && (
          <div className="mt-3 pt-3 border-t border-white/5">
            <NavRow item={{ icon: 'building', label: 'Организация', to: '/institution' }} />
          </div>
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
          <Icon name="log-out" className="flex-shrink-0" />
          <span className="text-sm font-sans">Выйти</span>
        </button>
      </div>
    </aside>
  )
}
