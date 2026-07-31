// Stable, deterministic color per id (course, etc.) for list tags where
// several categories appear side by side and need to be told apart at a
// glance — same id always maps to the same color, no state/lookup needed.
// Distinct from the app's semantic colors (amber = brand, success/warning/
// danger/info = status meaning) — these carry no meaning beyond "same tag".

const PALETTE = [
  { bg: 'bg-blue-50',    text: 'text-blue-700' },
  { bg: 'bg-purple-50',  text: 'text-purple-700' },
  { bg: 'bg-rose-50',    text: 'text-rose-700' },
  { bg: 'bg-teal-50',    text: 'text-teal-700' },
  { bg: 'bg-indigo-50',  text: 'text-indigo-700' },
  { bg: 'bg-cyan-50',    text: 'text-cyan-700' },
  { bg: 'bg-fuchsia-50', text: 'text-fuchsia-700' },
]

function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** `${bg} ${text}` Tailwind classes, stable per id. */
export function tagColorClasses(id: string): string {
  const { bg, text } = PALETTE[hashString(id) % PALETTE.length]
  return `${bg} ${text}`
}
