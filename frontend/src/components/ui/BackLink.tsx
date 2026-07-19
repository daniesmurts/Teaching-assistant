import { useNavigate } from 'react-router-dom'

// A "return to where you came from" navigation link — deliberately amber-
// tinted rather than the plain grey `secondary` Button variant. A neutral
// outline button here reads as just another toolbar action and gets lost
// next to siblings like "← Новый тест"; the amber tint signals "this takes
// you back to the thing you were working on" at a glance.
interface Props {
  to:    string
  label: string
}

export default function BackLink({ to, label }: Props) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(to)}
      className="inline-flex items-center px-3 py-1.5 rounded-md bg-amber-light border border-amber-mid/40 text-xs font-sans font-medium text-amber shadow-sm whitespace-nowrap hover:bg-amber/15 hover:border-amber transition-colors"
    >
      {label}
    </button>
  )
}
