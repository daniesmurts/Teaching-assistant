import Button from './Button'

// Primary "+ Создать X" CTA used across the app's TopBars. Centralised here
// because the previous pattern — `<Button size="sm">+ Новый X</Button>` —
// produced a small amber pill in the far corner of a wide top bar that
// teachers' eyes routinely missed. This wrapper bumps the button to the
// default (md) size and replaces the inline "+" text glyph with a real
// circular plus icon, giving the button a clear pre-attentive anchor.
//
// Use everywhere a teacher / admin creates a new item from a TopBar action
// slot: subjects, criteria, rubrics, institutions, eval runs, etc.

interface Props {
  onClick:   () => void
  children:  React.ReactNode    // label after the plus (e.g. "Новый предмет")
  disabled?: boolean
  loading?:  boolean
}

export default function CreateButton({ onClick, children, disabled, loading }: Props) {
  return (
    <Button onClick={onClick} disabled={disabled} loading={loading}>
      {/* Tinted circle anchors the eye. Plus glyph drawn as SVG so it never
          falls back to an OS-rendered character that varies by platform. */}
      <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-white/25 flex-shrink-0">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none"
             stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M5 1.5v7M1.5 5h7" />
        </svg>
      </span>
      {children}
    </Button>
  )
}
