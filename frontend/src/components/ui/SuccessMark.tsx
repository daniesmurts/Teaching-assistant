// Brand-aligned success indicator. Replaces ✅/🎉/🙏-style OS emojis on
// confirmation screens — they render inconsistently across platforms and break
// the editorial design language. Uses the design system success / amber tokens.

interface Props {
  tone?: 'success' | 'amber'
  size?: 'md' | 'lg'
}

export default function SuccessMark({ tone = 'success', size = 'lg' }: Props) {
  const dim = size === 'lg' ? 64 : 48
  const tones = {
    success: { bg: 'bg-success-bg', ring: 'border-success/20', stroke: 'var(--color-success)' },
    amber:   { bg: 'bg-amber-light', ring: 'border-amber/25',  stroke: 'var(--color-amber)' },
  }[tone]

  return (
    <div
      className={`mx-auto mb-4 rounded-full border ${tones.bg} ${tones.ring} flex items-center justify-center`}
      style={{ width: dim, height: dim }}
      aria-hidden="true"
    >
      <svg
        width={dim * 0.5}
        height={dim * 0.5}
        viewBox="0 0 24 24"
        fill="none"
        stroke={tones.stroke}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 12.5l4.5 4.5L19 7" />
      </svg>
    </div>
  )
}
