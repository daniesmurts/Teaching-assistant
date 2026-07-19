import { useState } from 'react'
import Icon from './Icon'

// A "copy all" action used to be reimplemented separately on every generator
// page (Quizzes, MaterialGenerator, Topics, SlideContent) with three
// different visual treatments — a plain text link in two places, a full
// secondary Button in another — and no shared width/wrap handling, so it
// broke onto two lines inside its own border on narrower layouts. One
// component, one look, `whitespace-nowrap` so it never wraps.
//
// `onCopy` does the actual clipboard write (plain text in most callers, rich
// HTML+text via copyRich for slides) — this component only owns the
// click → flash-confirmation lifecycle. Return `false` to signal a failed
// copy and skip the confirmation flash.
interface Props {
  onCopy: () => void | boolean | Promise<void | boolean>
  label?: string
}

export default function CopyAllButton({ onCopy, label = 'Скопировать всё' }: Props) {
  const [copied, setCopied] = useState(false)

  async function handleClick() {
    const result = await onCopy()
    if (result === false) return
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-border-mid text-xs font-sans font-medium text-ink-secondary shadow-sm whitespace-nowrap shrink-0 hover:border-amber hover:text-amber transition-colors"
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Скопировано' : label}
    </button>
  )
}
