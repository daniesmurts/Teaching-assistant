import { ButtonHTMLAttributes } from 'react'
import LoadingSpinner from './LoadingSpinner'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger'
  loading?: boolean
  size?: 'sm' | 'md'
}

export default function Button({
  variant = 'primary',
  loading = false,
  size = 'md',
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const base = 'inline-flex items-center justify-center gap-2 font-sans font-medium rounded-md transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed'
  const sizes = { sm: 'px-3 py-1.5 text-xs', md: 'px-4 py-2 text-sm' }
  const variants = {
    // White on amber is 5.05:1 since the token was darkened (index.css) — it
    // was 3.06:1, under the AA floor for the 12–13px labels `size="sm"` puts
    // here. Hover DARKENS rather than fading: `hover:opacity-90` blended the
    // button into the page and dimmed its label with it, so contrast fell to
    // 3.83:1 exactly when the user was aiming at it. amber-deep is 6.24:1.
    primary: 'bg-amber text-white hover:bg-amber-deep',
    secondary: 'border border-border-mid bg-transparent text-ink-secondary hover:bg-surface-warm',
    // 5.44:1, and 4.65:1 even faded to 90% — danger is dark enough that the
    // same fade stays legal, so it is left alone.
    danger: 'bg-danger text-white hover:opacity-90',
  }

  return (
    <button
      className={`${base} ${sizes[size]} ${variants[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading && <LoadingSpinner size={size === 'sm' ? 12 : 14} />}
      {children}
    </button>
  )
}
