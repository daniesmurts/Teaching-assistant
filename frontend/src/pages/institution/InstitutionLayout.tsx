import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../store/authStore'

const NAV = [
  { to: '/institution',           label: 'Обзор',         end: true },
  { to: '/institution/structure', label: 'Структура',     end: false },
  { to: '/institution/usage',     label: 'Использование', end: false },
  { to: '/institution/teachers', label: 'Преподаватели', end: false },
  { to: '/institution/rubrics',  label: 'Критерии',      end: false },
  { to: '/institution/rubric-presets', label: 'Рубрики',  end: false },
  { to: '/institution/programs',  label: 'Образовательные программы', end: false },
  { to: '/institution/shared-rag', label: 'Общий цикл',  end: false },
  { to: '/institution/model',      label: 'Модель ИИ',   end: false },
  { to: '/institution/audit',    label: 'Журнал действий', end: false },
]

export default function InstitutionLayout() {
  const teacher   = useAuthStore((s) => s.teacher)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const navigate  = useNavigate()

  // A teacher can only reach this panel via institution_admin/platform_admin.
  // If they aren't attached to an institution (e.g. a platform admin), don't
  // fire the scoped queries — they'd 400. Show a pointer instead.
  const noInstitution = !teacher?.institution_id

  return (
    <div className="flex min-h-screen bg-bg">
      <aside className="w-[210px] min-h-screen bg-sidebar flex flex-col flex-shrink-0 print:hidden">
        <div className="px-4 py-4 border-b border-white/5">
          <span className="font-display text-[19px] font-bold text-ink-inverse tracking-tight">
            ИСПУМ <span className="text-amber-mid">Организация</span>
          </span>
          <div className="text-[10px] font-sans text-ink-inv-muted mt-0.5 uppercase tracking-wider">
            Панель администратора
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
        ) : (
          <Outlet />
        )}
      </div>
    </div>
  )
}
