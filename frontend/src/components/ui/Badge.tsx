type BadgeVariant = 'pending' | 'approved' | 'sent' | 'default'

const styles: Record<BadgeVariant, string> = {
  pending:  'bg-warning-bg text-warning',
  approved: 'bg-success-bg text-success',
  sent:     'bg-info-bg text-info',
  default:  'bg-surface-warm text-ink-secondary',
}

const labels: Record<BadgeVariant, string> = {
  pending:  'На проверке',
  approved: 'Подтверждено',
  sent:     'Отправлено',
  default:  '',
}

export default function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children?: React.ReactNode
  variant?: BadgeVariant
  // Only meaningful with variant='default' — overrides its bg/text color
  // (e.g. per-category tag colors via lib/tagColor.ts) while keeping the
  // shared padding/rounding/font.
  className?: string
}) {
  const text = variant !== 'default' ? labels[variant] : children
  return (
    <span className={`inline-block max-w-full truncate align-bottom text-xs font-sans font-medium px-2 py-0.5 rounded-sm ${className || styles[variant]}`}>
      {text}
    </span>
  )
}
