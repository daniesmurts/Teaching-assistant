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
    primary: 'bg-amber text-white hover:opacity-90',
    secondary: 'border border-border-mid bg-transparent text-ink-secondary hover:bg-surface-warm',
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
