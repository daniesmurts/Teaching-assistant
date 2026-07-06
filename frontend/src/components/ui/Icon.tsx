import type { JSX } from 'react'

// Inline SVG icons — replaces the Unicode glyphs that some browsers render as
// emojis (iOS, certain Android, some Windows configs). All icons share a 24×24
// viewBox, 1.5 stroke, rounded caps — minimal editorial style.
// Inherits color via `currentColor`, so tailwind text-* classes just work.

export type IconName =
  | 'home'
  | 'sparkle'         // grading (AI)
  | 'clock'           // journal / history
  | 'users'           // students
  | 'presentation'
  | 'lightbulb'       // topics
  | 'quiz'            // quick-check quiz
  | 'book'            // subjects (formerly «курсы»)
  | 'list-checks'     // rubrics / criteria
  | 'diamond'         // pricing / plan
  | 'settings'
  | 'help-circle'
  | 'mail'            // feedback
  | 'building'        // institution
  | 'layers'          // curriculum overlap analysis
  | 'grid'            // materials hub
  | 'log-out'
  | 'bar-chart'       // leadership dashboard
  | 'play-circle'     // video tutorials
  | 'check'           // inline confirmation / benefit bullets
  | 'scale'           // calibration / consistency
  | 'file-check'      // programme conformance
  | 'shield'          // security / compliance / trust

const PATHS: Record<IconName, JSX.Element> = {
  home: (
    <>
      <path d="M3 10.5L12 3l9 7.5V20a1.5 1.5 0 0 1-1.5 1.5h-4.5v-7h-6v7H4.5A1.5 1.5 0 0 1 3 20v-9.5z" />
    </>
  ),

  sparkle: (
    <path d="M12 2.5l2 6.5 6.5 2-6.5 2-2 6.5-2-6.5-6.5-2 6.5-2z" />
  ),

  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),

  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>
  ),

  presentation: (
    <>
      <rect x="3" y="3" width="18" height="14" rx="1.5" />
      <path d="M3 17h18" />
      <path d="M8 21l2-4" />
      <path d="M16 21l-2-4" />
    </>
  ),

  lightbulb: (
    <>
      <path d="M15 14a5 5 0 1 0-6 0" />
      <path d="M9 17h6" />
      <path d="M10 21h4" />
    </>
  ),

  quiz: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M10 9c0-1.5 1-2.5 2-2.5s2 1 2 2c0 1.5-2 1.5-2 3" />
      <circle cx="12" cy="16" r="0.6" />
    </>
  ),

  book: (
    <>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
    </>
  ),

  'list-checks': (
    <>
      <path d="M3 7l1.5 1.5L8 5" />
      <path d="M3 13l1.5 1.5L8 11" />
      <path d="M3 19l1.5 1.5L8 17" />
      <path d="M13 7h8" />
      <path d="M13 13h8" />
      <path d="M13 19h8" />
    </>
  ),

  diamond: (
    <>
      <path d="M3 9l4-5.5h10L21 9l-9 12L3 9z" />
      <path d="M3 9h18" />
      <path d="M7 3.5L12 9l5-5.5" />
    </>
  ),

  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.43 12.98a7.97 7.97 0 0 0 0-1.96l2.1-1.65a.5.5 0 0 0 .12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a8 8 0 0 0-1.7-.98l-.37-2.65A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42l-.37 2.65a8 8 0 0 0-1.7.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.1 1.65a7.97 7.97 0 0 0 0 1.96l-2.1 1.65a.5.5 0 0 0-.12.64l2 3.46a.5.5 0 0 0 .6.22l2.49-1c.52.4 1.1.73 1.7.98l.37 2.65A.5.5 0 0 0 10 22h4a.5.5 0 0 0 .5-.42l.37-2.65a8 8 0 0 0 1.7-.98l2.49 1a.5.5 0 0 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.1-1.65z" />
    </>
  ),

  'help-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 4" />
      <path d="M12 17h.01" />
    </>
  ),

  mail: (
    <>
      <rect x="2" y="5" width="20" height="14" rx="1.5" />
      <path d="M3 7l9 6 9-6" />
    </>
  ),

  building: (
    <>
      <path d="M4 22V4a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v18" />
      <path d="M2 22h20" />
      <path d="M8 7h2" /><path d="M14 7h2" />
      <path d="M8 11h2" /><path d="M14 11h2" />
      <path d="M8 15h2" /><path d="M14 15h2" />
      <path d="M10 22v-4h4v4" />
    </>
  ),

  layers: (
    <>
      <path d="M12 2 2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </>
  ),

  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),

  'log-out': (
    <>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </>
  ),

  'bar-chart': (
    <>
      <path d="M3 21h18" />
      <path d="M7 17V11" />
      <path d="M12 17V6" />
      <path d="M17 17v-8" />
    </>
  ),

  'play-circle': (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M10 8.5l5.5 3.5-5.5 3.5v-7z" />
    </>
  ),

  check: (
    <path d="M5 12.5l4.5 4.5L19 7" />
  ),

  scale: (
    <>
      <path d="M12 3v18" />
      <path d="M5 8h14" />
      <path d="M5 8l-3 6a3.2 3.2 0 0 0 6 0l-3-6z" />
      <path d="M19 8l-3 6a3.2 3.2 0 0 0 6 0l-3-6z" />
    </>
  ),

  'file-check': (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z" />
      <path d="M14 2v6h6" />
      <path d="M9 14.5l2 2 4-4.5" />
    </>
  ),

  shield: (
    <path d="M12 2.5l7.5 3v5.2c0 4.7-3.2 8.9-7.5 10.3-4.3-1.4-7.5-5.6-7.5-10.3V5.5l7.5-3z" />
  ),
}

interface Props {
  name:       IconName
  className?: string
  size?:      number
}

export default function Icon({ name, className, size = 16 }: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {PATHS[name]}
    </svg>
  )
}
