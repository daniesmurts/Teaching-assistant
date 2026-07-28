import { useState } from 'react'
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../store/authStore'
import { logout as logoutApi } from '../../api/auth'
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
    { icon: 'bar-chart',    label: 'БРС',            to: '/brs' },
    { icon: 'list-checks',  label: 'Библиотека',     to: '/library' },
  ]},
  { label: 'Генерация', items: [
    { icon: 'grid',         label: 'Материалы',      to: '/materials', essential: true,
      match: ['/materials', '/presentations', '/topics', '/quizzes'] },
  ]},
  { label: 'Управление', items: [
    { icon: 'book',         label: 'Предметы',       to: '/courses', essential: true },
    // Essential so fresh accounts (РОП pilot) see the студия without needing
    // a first grading to unlock the full nav.
    { icon: 'layers',       label: 'РПД-студия',     to: '/curriculum', essential: true },
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

  // Count of hidden items — surfaced on the «Показать всё» button so a
  // brand-new user knows there's more nav to reveal, rather than assuming
  // the slimmed menu is the whole app.
  const hiddenNavCount = NAV_GROUPS
    .filter((g) => !g.alwaysShow)
    .flatMap((g) => g.items)
    .filter((i) => !i.essential)
    .length

  function showAll() {
    try { localStorage.setItem(NAV_EXPANDED_KEY, '1') } catch { /* ignore */ }
    setExpanded(true)
  }

  const initials =
    initialsForAvatar(teacher?.name) || teacher?.email?.[0]?.toUpperCase() || '?'

  // Flat platform-owner flag — distinct from isInstitutionAdmin below, which
  // also covers per-institution admins that shouldn't see the platform panel.
  const isPlatformAdmin = teacher?.is_platform_admin ?? teacher?.role === 'platform_admin'
  // Org-tree-derived (§7), with legacy-enum fallback for pre-upgrade sessions.
  const isInstitutionAdmin =
    isPlatformAdmin ||
    (teacher?.is_institution_admin ?? teacher?.role === 'institution_admin')
  // Any head/admin on a unit (or platform/institution admin transitively).
  const isLeader =
    (teacher?.is_leader ?? false) || isInstitutionAdmin
  // РОП / начальник УМЦ / проректор / IT admin all get the «Образовательные
  // программы» entry. Server resolves the actual per-row scope.
  const canSeePrograms =
    (teacher?.program_access && teacher.program_access !== 'none') || isInstitutionAdmin
  // Research.md §7.10 Phase 1 — a curriculum-domain grant (e.g. УМЦ head)
  // reaches the «Организация» panel too, scoped to what it covers
  // (InstitutionLayout filters the NAV), without being an institution admin.
  const hasCurriculumAccess =
    !!teacher?.curriculum_access && teacher.curriculum_access !== 'none'
  // Research.md §7.10 Phase 2 — a teaching-domain grant (e.g. ПР УР) reaches
  // the «Организация» panel too (Обзор/Использование/roster read), scoped by
  // InstitutionLayout the same way curriculum access is.
  const hasTeachingAccess =
    !!teacher?.teaching_access && teacher.teaching_access !== 'none'
  // Research.md §7.10 Phase 3 slice B — a platform-domain grant (e.g. an
  // institute director scoped to their own subtree) reaches the
  // «Организация» panel too (Структура), scoped the same way.
  const hasPlatformAccess =
    !!teacher?.platform_access && teacher.platform_access !== 'none'
  // docs/ACCESS-MATRIX.md — a umu-domain grant (Методист/Нач. УМУ, РУМЦ)
  // reaches the panel for Мониторинг РПД, scoped the same way.
  const hasUmuAccess =
    !!teacher?.umu_access && teacher.umu_access !== 'none'
  const canSeeInstitutionPanel =
    isInstitutionAdmin || hasCurriculumAccess || hasTeachingAccess || hasPlatformAccess || hasUmuAccess

  function logout() { logoutApi().catch(() => {}); clearAuth(); navigate('/login') }

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

        {/* Show-all toggle — only while the slimmed nav is active. Brighter
            than a regular muted nav row and shows the hidden count so a
            brand-new user recognises there's more to reveal. */}
        {minimal && (
          <button
            onClick={showAll}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-md mt-3 pt-3 border-t border-white/10 text-ink-inverse hover:bg-sidebar-hover transition-colors"
          >
            <span className="flex-shrink-0 w-4 text-center text-xs text-amber-mid">▾</span>
            <span className="text-sm font-sans font-medium flex-1 text-left">Показать всё</span>
            {hiddenNavCount > 0 && (
              <span className="text-[10px] font-sans font-semibold text-amber-mid bg-amber/15 border border-amber-mid/25 rounded-sm px-1.5 py-0.5">
                +{hiddenNavCount}
              </span>
            )}
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

        {/* Role-driven entries — leadership dashboard, programs, institution admin */}
        {(isLeader || canSeePrograms || canSeeInstitutionPanel) && (
          <div className="mt-3 pt-3 border-t border-white/5 space-y-0.5">
            {isLeader && (
              <NavRow item={{ icon: 'bar-chart', label: 'Сводка', to: '/leadership' }} />
            )}
            {canSeePrograms && (
              <NavRow item={{ icon: 'list-checks', label: 'Образовательные программы', to: '/programs' }} />
            )}
            {canSeePrograms && (
              <NavRow item={{ icon: 'bar-chart', label: 'РОП Студия', to: '/rop-studio' }} />
            )}
            {canSeeInstitutionPanel && (
              <NavRow item={{ icon: 'building', label: 'Организация', to: '/institution' }} />
            )}
            {isPlatformAdmin && (
              <NavRow item={{ icon: 'shield', label: 'Админ-панель', to: '/admin' }} />
            )}
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
        <div className="px-1 pt-1 text-[10px] font-sans text-ink-inv-muted/60 truncate" title={`Сборка ${__APP_VERSION__}`}>
          {__APP_VERSION__}
        </div>
      </div>
    </aside>
  )
}
