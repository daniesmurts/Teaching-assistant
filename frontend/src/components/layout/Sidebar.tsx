import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../store/authStore'
import { getCourses } from '../../api/courses'
import { getGradingStats } from '../../api/grading'
import Icon, { type IconName } from '../ui/Icon'
import { initialsForAvatar } from '../../lib/teacherName'

// `essential` items show in the slimmed nav a brand-new user sees; `alwaysShow`
// groups (account) always render even before activation.
interface NavItem { icon: IconName; label: string; to: string; match?: string[]; essential?: boolean }
interface NavGroup { label?: string; items: NavItem[]; alwaysShow?: boolean }

const NAV_EXPANDED_KEY = 'ga_nav_expanded'

// Grouped by what the teacher is trying to do — top to bottom: overview →
// grading → AI generation → setup → account.
const NAV_GROUPS: NavGroup[] = [
  { items: [
    { icon: 'home',         label: 'Главная',        to: '/dashboard', essential: true },
  ]},
  { label: 'Проверка', items: [
    { icon: 'sparkle',      label: 'Проверка работ', to: '/grading', essential: true },
    { icon: 'list-checks',  label: 'Задания',        to: '/published', match: ['/published'] },
    { icon: 'clock',        label: 'Журнал',         to: '/history' },
    { icon: 'users',        label: 'Студенты',       to: '/students' },
    { icon: 'list-checks',  label: 'Библиотека',     to: '/library' },
  ]},
  { label: 'Генерация', items: [
    { icon: 'grid',         label: 'Материалы',      to: '/materials', essential: true,
      match: ['/materials', '/presentations', '/topics', '/quizzes'] },
  ]},
  { label: 'Управление', items: [
    { icon: 'book',         label: 'Предметы',       to: '/courses', essential: true },
    { icon: 'layers',       label: 'Учебный план',   to: '/curriculum' },
    { icon: 'list-checks',  label: 'Критерии',       to: '/criteria' },
    { icon: 'list-checks',  label: 'Рубрики',        to: '/rubrics' },
    { icon: 'sparkle',      label: 'Учебный цикл',   to: '/learning-loop' },
  ]},
  { label: 'Аккаунт', alwaysShow: true, items: [
    { icon: 'diamond',      label: 'Тариф',          to: '/billing' },
    { icon: 'settings',     label: 'Настройки',      to: '/settings' },
    { icon: 'help-circle',  label: 'Помощь',         to: '/help' },
  ]},
]

function NavRow({ item }: { item: NavItem }) {
  const { pathname } = useLocation()
  // Keep a parent item (e.g. «Материалы») highlighted while the user is on one of
  // its child pages (/presentations, /topics, /quizzes), for orientation.
  const matched = item.match?.some((p) => pathname === p || pathname.startsWith(p + '/'))
  return (
    <NavLink to={item.to}>
      {({ isActive }) => {
        const active = isActive || matched
        return (
          <div className={`flex items-center gap-2.5 px-3 py-2 rounded-md cursor-pointer transition-colors ${
            active ? 'bg-sidebar-active' : 'hover:bg-sidebar-hover'
          }`}>
            <Icon
              name={item.icon}
              className={`flex-shrink-0 ${active ? 'text-amber-mid' : 'text-ink-inv-muted'}`}
            />
            <span className={`text-sm font-sans ${active ? 'font-medium text-ink-inverse' : 'font-normal text-ink-inv-muted'}`}>
              {item.label}
            </span>
          </div>
        )
      }}
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

  const [expanded, setExpanded] = useState<boolean>(() => {
    try { return localStorage.getItem(NAV_EXPANDED_KEY) === '1' } catch { return false }
  })

  // Progressive nav: a brand-new user (no subject + no first grade) sees only the
  // essential start-here items, with a «Показать всё» toggle. Once activated, the
  // full nav appears automatically. While data loads we default to the full nav so
  // returning users never see a flash of the slimmed menu.
  const { data: courses } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: stats }   = useQuery({ queryKey: ['grading-stats'], queryFn: getGradingStats })
  const ready     = courses !== undefined && stats !== undefined
  const activated = ready && courses.length > 0 && (stats?.total ?? 0) > 0
  const minimal   = ready && !activated && !expanded

  // Slimmed view: all essential items as one tight unlabeled list, then the
  // always-show (account) groups. Full view: the normal grouped nav.
  const groups: NavGroup[] = minimal
    ? [
        { items: NAV_GROUPS.flatMap((g) => (g.alwaysShow ? [] : g.items.filter((i) => i.essential))) },
        ...NAV_GROUPS.filter((g) => g.alwaysShow),
      ]
    : NAV_GROUPS

  function showAll() {
    try { localStorage.setItem(NAV_EXPANDED_KEY, '1') } catch { /* ignore */ }
    setExpanded(true)
  }

  const initials =
    initialsForAvatar(teacher?.name) || teacher?.email?.[0]?.toUpperCase() || '?'

  // Org-tree-derived (§7), with legacy-enum fallback for pre-upgrade sessions.
  const isInstitutionAdmin =
    (teacher?.is_platform_admin ?? teacher?.role === 'platform_admin') ||
    (teacher?.is_institution_admin ?? teacher?.role === 'institution_admin')

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

      {/* Nav — grouped into labeled sections (slimmed for brand-new users) */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {groups.map((group, gi) => (
          <div key={group.label ?? gi} className={gi > 0 ? 'mt-3' : ''}>
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

        {/* Show-all toggle — only while the slimmed nav is active */}
        {minimal && (
          <button
            onClick={showAll}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md mt-2 text-ink-inv-muted hover:bg-sidebar-hover hover:text-ink-inverse transition-colors"
          >
            <span className="flex-shrink-0 w-4 text-center text-xs">▾</span>
            <span className="text-sm font-sans">Показать всё</span>
          </button>
        )}

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
