import { useUIStore } from '../../store/uiStore'

interface TopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function TopBar({ title, subtitle, actions }: TopBarProps) {
  const setMobileSidebarOpen = useUIStore((s) => s.setMobileSidebarOpen)

  return (
    <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-4 md:px-6 flex-shrink-0">
      <div className="flex items-center gap-3">
        {/* Hamburger — mobile only */}
        <button
          onClick={() => setMobileSidebarOpen(true)}
          className="md:hidden flex flex-col gap-[5px] p-1 text-ink-secondary hover:text-ink transition-colors"
          aria-label="Открыть меню"
        >
          <span className="block w-5 h-[1.5px] bg-current rounded" />
          <span className="block w-5 h-[1.5px] bg-current rounded" />
          <span className="block w-5 h-[1.5px] bg-current rounded" />
        </button>

        <div className="flex items-baseline gap-2">
          <h2 className="font-sans text-sm font-medium text-ink">{title}</h2>
          {subtitle && (
            <span className="font-sans text-xs text-ink-tertiary hidden sm:inline">{subtitle}</span>
          )}
        </div>
      </div>

      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
