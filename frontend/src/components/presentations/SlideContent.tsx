import { useState } from 'react'

// ─── Parser ───────────────────────────────────────────────────────────────────

interface Slide {
  number: number
  title: string
  bullets: string[]
  notes: string
}

function parseSlides(content: string): Slide[] {
  // Split on the "---" separator the prompt enforces
  const sections = content.split(/\n---\n/).map(s => s.trim()).filter(Boolean)

  const slides: Slide[] = []

  for (const section of sections) {
    // Match  "СЛАЙД N: Title"  (also accept English SLIDE for safety)
    const headerMatch = section.match(/^(?:СЛАЙД|SLIDE)\s+(\d+):\s*(.+)$/im)
    if (!headerMatch) continue

    const number = parseInt(headerMatch[1], 10)
    const title  = headerMatch[2].trim()

    // Speaker notes block
    const notesMatch = section.match(/(?:ЗАМЕТКИ ДОКЛАДЧИКА|SPEAKER NOTES):\n([\s\S]+?)(?:\n---|\s*$)/i)
    const notes = notesMatch ? notesMatch[1].trim() : ''

    // Bullet lines — everything between the header and the notes block
    const headerEnd   = section.indexOf('\n')
    const notesStart  = notesMatch ? section.indexOf(notesMatch[0]) : section.length
    const bulletBlock = section.slice(headerEnd, notesStart).trim()

    const bullets = bulletBlock
      .split('\n')
      .map(l => l.trim())
      .filter(l => /^[•·\-*–—]/.test(l))
      .map(l => l.replace(/^[•·\-*–—]\s*/, '').trim())
      .filter(Boolean)

    slides.push({ number, title, bullets, notes })
  }

  return slides
}

// ─── SlideCard ────────────────────────────────────────────────────────────────

function SlideCard({ slide }: { slide: Slide }) {
  const [copied, setCopied] = useState(false)

  function copySlide() {
    const text = [
      `Слайд ${slide.number}: ${slide.title}`,
      '',
      ...slide.bullets.map(b => `• ${b}`),
      '',
      'Заметки докладчика:',
      slide.notes,
    ].join('\n')

    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden mb-4">
      {/* Card header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] font-sans font-semibold bg-amber-light text-amber px-2 py-0.5 rounded-sm flex-shrink-0 uppercase tracking-wide">
            Слайд {slide.number}
          </span>
          <h3 className="font-display text-[15px] font-bold text-ink truncate">
            {slide.title}
          </h3>
        </div>
        <button
          onClick={copySlide}
          className="ml-3 text-xs font-sans text-ink-secondary hover:text-amber transition-colors flex-shrink-0"
        >
          {copied ? '✓ Скопировано' : 'Копировать'}
        </button>
      </div>

      {/* Two-column body */}
      <div className="grid grid-cols-[3fr_2fr]">
        {/* Left — bullet points */}
        <div className="p-4 border-r border-border space-y-2">
          {slide.bullets.length > 0 ? (
            slide.bullets.map((b, i) => (
              <div key={i} className="flex gap-2 text-sm font-sans text-ink leading-relaxed">
                <span className="text-amber mt-0.5 flex-shrink-0 select-none">•</span>
                <span>{b}</span>
              </div>
            ))
          ) : (
            <p className="text-sm font-sans text-ink-tertiary italic">Нет тезисов</p>
          )}
        </div>

        {/* Right — speaker notes */}
        <div className="p-4 bg-surface-warm">
          <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Заметки докладчика
          </div>
          {slide.notes ? (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">{slide.notes}</p>
          ) : (
            <p className="text-xs font-sans text-ink-tertiary italic">—</p>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── SlideContent (public component) ─────────────────────────────────────────

interface Props {
  content: string
}

export default function SlideContent({ content }: Props) {
  const [copiedAll, setCopiedAll] = useState(false)
  const slides = parseSlides(content)

  function copyAll() {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 2000)
    })
  }

  if (slides.length === 0) {
    // Fallback: raw content if parsing fails
    return (
      <div className="bg-surface border border-border rounded-lg p-5">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
          Сгенерированное содержание
        </div>
        <pre className="text-sm font-mono text-ink whitespace-pre-wrap leading-relaxed">{content}</pre>
      </div>
    )
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="flex items-center justify-between mb-4">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          {slides.length} слайдов
        </div>
        <button
          onClick={copyAll}
          className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors"
        >
          {copiedAll ? '✓ Скопировано' : 'Скопировать всё'}
        </button>
      </div>

      {/* Slide cards */}
      {slides.map(slide => (
        <SlideCard key={slide.number} slide={slide} />
      ))}
    </div>
  )
}
