import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

// Research.md §7.10 — each entry declares which domain-grant reaches it.
// `undefined` = institution-root admin only (unchanged, Phase 3 territory).
// 'curriculum'/'teaching' entries additionally open for that domain's grant;
// `minLevel` matches the backend's requireDomain minimum so a view-only grant
// doesn't see a tab that would just 403 (RPD monitor and criteria/rubrics
// writes require 'edit' server-side; the Phase 2 teaching routes are all
// read-only, so 'view' is enough for all of them).
type NavDomain = 'curriculum' | 'teaching'
const NAV: { to: string; label: string; end: boolean; domain?: NavDomain; minLevel?: 'view' | 'edit' }[] = [
  { to: '/institution',           label: 'Обзор',         end: true, domain: 'teaching', minLevel: 'view' },
  { to: '/institution/structure', label: 'Структура',     end: false },
  { to: '/institution/rpd',       label: 'Мониторинг РПД', end: false, domain: 'curriculum', minLevel: 'edit' },
  { to: '/institution/usage',     label: 'Использование', end: false, domain: 'teaching', minLevel: 'view' },
  { to: '/institution/teachers', label: 'Преподаватели', end: false, domain: 'teaching', minLevel: 'view' },
  { to: '/institution/rubrics',  label: 'Критерии',      end: false, domain: 'curriculum', minLevel: 'view' },
  { to: '/institution/rubric-presets', label: 'Рубрики',  end: false, domain: 'curriculum', minLevel: 'view' },
  { to: '/programs',              label: 'Образовательные программы', end: false },
  { to: '/institution/shared-rag', label: 'Общий цикл',  end: false },
  { to: '/institution/model',      label: 'Модель ИИ',   end: false },
  { to: '/institution/lti',        label: 'LTI / LMS',   end: false },
  { to: '/institution/audit',    label: 'Журнал действий', end: false },
]

const DOMAIN_LEVEL_RANK: Record<string, number> = { view: 1, edit: 2, admin: 3 }

/** The teacher's access level for a NAV item's domain, ranked. 0 = no access
 *  (item.domain undefined items are handled separately — admin-only). */
function domainRank(teacher: { curriculum_access?: string; teaching_access?: string } | null, domain?: NavDomain): number {
  if (!domain) return 0
  const value = domain === 'curriculum' ? teacher?.curriculum_access : teacher?.teaching_access
  return DOMAIN_LEVEL_RANK[value ?? ''] ?? 0
}

export default function InstitutionLayout() {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()
  const location  = useLocation()

  // A teacher can only reach this panel via institution_admin/platform_admin.
  // If they aren't attached to an institution (e.g. a platform admin), don't
  // fire the scoped queries — they'd 400. Show a pointer instead.
  const noInstitution = !teacher?.institution_id

  // Research.md §7.10 — an institution/platform admin sees the full NAV
  // (unchanged); a domain-only grant (e.g. УМЦ head on curriculum, ПР УР on
  // teaching) sees only the entries its level actually reaches, so it never
  // offers a tab that would just 403.
  const isInstitutionAdmin =
    (teacher?.is_platform_admin ?? teacher?.role === 'platform_admin') ||
    (teacher?.is_institution_admin ?? teacher?.role === 'institution_admin')
  const visibleNav = isInstitutionAdmin
    ? NAV
    : NAV.filter((item) => item.domain
        && domainRank(teacher, item.domain) >= DOMAIN_LEVEL_RANK[item.minLevel ?? 'edit'])
  // Admin-only sub-routes (the index/Обзор page, and any /institution/* path
  // not in visibleNav — e.g. /institution/teachers, /institution/programs)
  // call institution-admin-only endpoints. A curriculum-only grant landing on
  // one directly (typed URL, stale bookmark) would just 403 after rendering
  // a dead-end form — redirect to the first tab it can actually use instead.
  // Admins are unaffected: visibleNav === NAV for them, so this never fires.
  const needsRedirectFromOverview =
    !isInstitutionAdmin
    && visibleNav.length > 0
    && !visibleNav.some((item) => item.to === location.pathname)

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="w-[210px] h-screen sticky top-0 self-start bg-sidebar flex flex-col flex-shrink-0 print:hidden">
        <div className="px-4 py-4 border-b border-white/5">
          <span className="font-display text-[19px] font-bold text-ink-inverse tracking-tight">
            ИСПУМ <span className="text-amber-mid">Организация</span>
          </span>
          <div className="text-[10px] font-sans text-ink-inv-muted mt-0.5 uppercase tracking-wider">
            Панель администратора
          </div>
        </div>

        <nav className="flex-1 px-2 py-3 space-y-0.5">
          {visibleNav.map((item) => (
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
        {noInstitution ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <div className="text-4xl mb-3">🏛️</div>
              <h2 className="font-display text-xl font-bold text-ink mb-2">Эта панель — для администраторов организаций</h2>
              <p className="font-sans text-sm text-ink-secondary mb-5">
                Ваш аккаунт не привязан к организации. Управление организациями и их администраторами доступно в админ-панели платформы.
              </p>
              {(teacher?.is_platform_admin ?? teacher?.role === 'platform_admin') && (
                <button
                  onClick={() => navigate('/admin/institutions')}
                  className="px-5 py-2.5 rounded-lg bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity"
                >
                  Перейти к организациям →
                </button>
              )}
            </div>
          </div>
        ) : needsRedirectFromOverview ? (
          <Navigate to={visibleNav[0].to} replace />
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
