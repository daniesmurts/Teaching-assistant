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
      // min-h-[40px] matches the action buttons it sits beside (DeckQuizPanel's
      // row, the PPTX export) and moves a 30px chip toward the 44px touch
      // target guidance. Shared by four generator pages, so they all grow
      // together rather than this one drifting.
      className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 py-2 rounded-md bg-surface border border-border-mid text-xs font-sans font-medium text-ink-secondary shadow-sm whitespace-nowrap shrink-0 hover:border-amber hover:text-amber transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
    >
      <Icon name={copied ? 'check' : 'copy'} size={13} />
      {copied ? 'Скопировано' : label}
    </button>
  )
}
