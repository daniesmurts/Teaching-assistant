import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Playfair Display"', 'Georgia', 'serif'],
        sans: ['"DM Sans"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      colors: {
        bg:              'var(--color-bg)',
        surface:         'var(--color-surface)',
        'surface-warm':  'var(--color-surface-warm)',
        sidebar:         'var(--color-sidebar)',
        'sidebar-hover': 'var(--color-sidebar-hover)',
        'sidebar-active':'var(--color-sidebar-active)',
        ink:             'var(--color-ink)',
        'ink-secondary': 'var(--color-ink-secondary)',
        'ink-tertiary':  'var(--color-ink-tertiary)',
        'ink-inverse':   'var(--color-ink-inverse)',
        'ink-inv-muted': 'var(--color-ink-inv-muted)',
        amber:           'var(--color-amber)',
        'amber-light':   'var(--color-amber-light)',
        'amber-mid':     'var(--color-amber-mid)',
        success:         'var(--color-success)',
        'success-bg':    'var(--color-success-bg)',
        warning:         'var(--color-warning)',
        'warning-bg':    'var(--color-warning-bg)',
        danger:          'var(--color-danger)',
        'danger-bg':     'var(--color-danger-bg)',
        info:            'var(--color-info)',
        'info-bg':       'var(--color-info-bg)',
        border:          'var(--color-border)',
        'border-mid':    'var(--color-border-mid)',
        'border-strong': 'var(--color-border-strong)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
      },
    },
  },
  plugins: [],
} satisfies Config
