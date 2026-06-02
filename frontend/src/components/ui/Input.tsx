import { InputHTMLAttributes, TextareaHTMLAttributes, forwardRef } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

const inputClass =
  'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md placeholder:text-ink-tertiary focus:outline-none focus:border-border-strong transition-colors'

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className = '', ...props }, ref) => (
    <div className="w-full">
      {label && (
        <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
          {label}
        </label>
      )}
      <input ref={ref} className={`${inputClass} ${error ? 'border-danger' : ''} ${className}`} {...props} />
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </div>
  )
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
