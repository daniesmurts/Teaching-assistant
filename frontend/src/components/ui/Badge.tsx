type BadgeVariant = 'pending' | 'approved' | 'sent' | 'default'

const styles: Record<BadgeVariant, string> = {
  pending:  'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  sent:     'bg-info-bg text-info',
  default:  'bg-surface-warm text-ink-secondary',
}

export default function Badge({
  children,
  variant = 'default',
}: {
  children: React.ReactNode
  variant?: BadgeVariant
}) {
  return (
    <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-sm capitalize ${styles[variant]}`}>
      {children}
    </span>
  )
}
