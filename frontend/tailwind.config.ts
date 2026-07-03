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
      // Solid tokens use the RGB channel vars with the <alpha-value> placeholder
      // so opacity modifiers work (bg-amber/80, border-success/15, …). The three
      // border tokens are translucent-black literals — left as-is (no modifiers).
      colors: {
        bg:              'rgb(var(--color-bg-rgb) / <alpha-value>)',
        surface:         'rgb(var(--color-surface-rgb) / <alpha-value>)',
        'surface-warm':  'rgb(var(--color-surface-warm-rgb) / <alpha-value>)',
        sidebar:         'rgb(var(--color-sidebar-rgb) / <alpha-value>)',
        'sidebar-hover': 'rgb(var(--color-sidebar-hover-rgb) / <alpha-value>)',
        'sidebar-active':'rgb(var(--color-sidebar-active-rgb) / <alpha-value>)',
        ink:             'rgb(var(--color-ink-rgb) / <alpha-value>)',
        'ink-secondary': 'rgb(var(--color-ink-secondary-rgb) / <alpha-value>)',
        'ink-tertiary':  'rgb(var(--color-ink-tertiary-rgb) / <alpha-value>)',
        'ink-inverse':   'rgb(var(--color-ink-inverse-rgb) / <alpha-value>)',
        'ink-inv-muted': 'rgb(var(--color-ink-inv-muted-rgb) / <alpha-value>)',
        amber:           'rgb(var(--color-amber-rgb) / <alpha-value>)',
        'amber-light':   'rgb(var(--color-amber-light-rgb) / <alpha-value>)',
        'amber-mid':     'rgb(var(--color-amber-mid-rgb) / <alpha-value>)',
        success:         'rgb(var(--color-success-rgb) / <alpha-value>)',
        'success-bg':    'rgb(var(--color-success-bg-rgb) / <alpha-value>)',
        warning:         'rgb(var(--color-warning-rgb) / <alpha-value>)',
        'warning-bg':    'rgb(var(--color-warning-bg-rgb) / <alpha-value>)',
        danger:          'rgb(var(--color-danger-rgb) / <alpha-value>)',
        'danger-bg':     'rgb(var(--color-danger-bg-rgb) / <alpha-value>)',
        info:            'rgb(var(--color-info-rgb) / <alpha-value>)',
        'info-bg':       'rgb(var(--color-info-bg-rgb) / <alpha-value>)',
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
