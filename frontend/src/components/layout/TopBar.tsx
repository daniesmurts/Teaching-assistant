interface TopBarProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export default function TopBar({ title, subtitle, actions }: TopBarProps) {
  return (
    <header className="h-12 bg-surface border-b border-border flex items-center justify-between px-6 flex-shrink-0">
      <div className="flex items-baseline gap-3">
        <h2 className="font-sans text-sm font-medium text-ink">{title}</h2>
        {subtitle && (
          <span className="font-sans text-xs text-ink-tertiary">{subtitle}</span>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}
