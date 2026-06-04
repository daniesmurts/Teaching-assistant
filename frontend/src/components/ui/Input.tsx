import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef, useState } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  reveal?: boolean   // show an eye toggle for password fields
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const inputClass =
  'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md placeholder:text-ink-tertiary focus:outline-none focus:border-border-strong transition-colors'

function EyeIcon({ off }: { off: boolean }) {
  return off ? (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20C5 20 1 12 1 12a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  ) : (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, reveal, type, className = '', ...props }, ref) => {
    const [show, setShow] = useState(false)
    const isPassword    = type === 'password'
    const effectiveType = isPassword && show ? 'text' : type

    return (
      <div className="w-full">
        {label && (
          <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
            {label}
          </label>
        )}
        <div className="relative">
          <input
            ref={ref}
            type={effectiveType}
            className={`${inputClass} ${reveal && isPassword ? 'pr-10' : ''} ${error ? 'border-danger' : ''} ${className}`}
            {...props}
          />
          {reveal && isPassword && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => setShow((s) => !s)}
              aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-tertiary hover:text-ink-secondary transition-colors"
            >
              <EyeIcon off={show} />
            </button>
          )}
        </div>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ label, error, className = '', ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
          {label}
        </label>
      )}
      <textarea
        ref={ref}
        className={`${inputClass} resize-none ${error ? 'border-danger' : ''} ${className}`}
        {...props}
      />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
)
Textarea.displayName = 'Textarea'

export default Input
