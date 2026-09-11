import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import Icon from '../ui/Icon'

// The four secondary destinations. From `lg` up they sit inline; below it they
// live in the toggle panel — `lg`, not `md`, because at exactly 768 px the full
// inline row still overflows the viewport by ~12 px. Previously they were
// `hidden md:block`, i.e. unreachable on a phone, while the three that stayed
// visible («О нас», «Войти», the CTA) each wrapped onto two lines in the
// 360-px gutter.
const NAV = [
  { to: '/about',        label: 'О нас' },
  { to: '/institutions', label: 'Для ВУЗов' },
  { to: '/research',     label: 'Исследования' },
  { to: '/docs',         label: 'Документация' },
]

export default function PublicHeader() {
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()

  // Close on navigation — the panel outlives the click otherwise, because the
  // route change re-renders in place rather than remounting the header.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  const linkCls = 'text-sm font-medium text-ink-secondary hover:text-ink transition-colors'

  return (
    <header className="relative max-w-[1000px] w-full mx-auto px-4 sm:px-6 py-4 sm:py-6 flex items-center justify-between gap-3">
      <Link
        to="/"
        title="ИСПУМ — Интеллектуальная Система Проверки и Подготовки Учебных Материалов"
        className="font-display font-bold text-xl tracking-tight hover:text-amber transition-colors shrink-0"
      >
        ИСПУМ
      </Link>

      <nav className="hidden lg:flex items-center gap-6">
        {NAV.map((item) => (
          <Link key={item.to} to={item.to} className={linkCls}>{item.label}</Link>
        ))}
      </nav>

      <div className="flex items-center gap-2 lg:gap-6 shrink-0">
        <Link to="/login" className={`hidden lg:block ${linkCls}`}>Войти</Link>
        {/* `whitespace-nowrap` is the fix for the wrapped CTA in the screenshot:
            the button is the last flex item, so without it the label breaks
            rather than the row growing. */}
        <Link
          to="/register"
          className="px-4 py-2 rounded-md bg-amber text-white text-sm font-medium whitespace-nowrap hover:bg-amber-deep transition-colors"
        >
          Начать бесплатно
        </Link>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? 'Закрыть меню' : 'Открыть меню'}
          aria-expanded={open}
          aria-controls="public-nav-mobile"
          className="lg:hidden -mr-2 flex items-center justify-center w-11 h-11 rounded-md text-ink-secondary hover:text-ink hover:bg-surface-warm transition-colors"
        >
          <Icon name={open ? 'close' : 'menu'} size={22} />
        </button>
      </div>

      {open && (
        <>
          {/* Backdrop sits below the panel but above the page, so a tap anywhere
              outside dismisses without navigating. */}
          <div className="fixed inset-0 z-30 lg:hidden" onClick={() => setOpen(false)} />
          <nav
            id="public-nav-mobile"
            className="absolute top-full left-4 right-4 z-40 lg:hidden rounded-lg border border-border bg-surface shadow-lg py-2"
          >
            {[...NAV, { to: '/login', label: 'Войти' }].map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="flex items-center min-h-[44px] px-4 text-sm font-medium text-ink-secondary hover:text-ink hover:bg-surface-warm transition-colors"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </>
      )}
    </header>
  )
}
