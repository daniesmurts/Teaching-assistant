import { useState } from 'react'
import type { PresentationSource } from '../../types'

// ─── Parser ───────────────────────────────────────────────────────────────────

interface Slide {
  number: number
  title: string
  bullets: string[]
  notes: string
}

function parseSlides(content: string): Slide[] {
  const sections = content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean)

  const slides: Slide[] = []

  for (const section of sections) {
    const headerMatch = section.match(/^(?:СЛАЙД|SLIDE)\s+(\d+):\s*(.+)$/im)
    if (!headerMatch) continue

    const number = parseInt(headerMatch[1], 10)
    const title  = headerMatch[2].trim()

    const notesMatch = section.match(/(?:ЗАМЕТКИ ДОКЛАДЧИКА|SPEAKER NOTES):\n([\s\S]+?)(?:\n---|\s*$)/i)
    const notes = notesMatch ? notesMatch[1].trim() : ''

    const headerEnd   = section.indexOf('\n')
    const notesStart  = notesMatch ? section.indexOf(notesMatch[0]) : section.length
    const bulletBlock = section.slice(headerEnd, notesStart).trim()

    const bullets = bulletBlock
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => /^[•·\-*–—]/.test(l))
      .map((l) => l.replace(/^[•·\-*–—]\s*/, '').trim())
      .filter(Boolean)

    slides.push({ number, title, bullets, notes })
  }

  return slides
}

// ─── Citation chips ───────────────────────────────────────────────────────────
//
// Walks a text fragment and replaces every "[N]" or "[N, M]" with a small
// clickable chip. Anything that isn't a citation marker is rendered as-is.

interface CitableProps {
  text:    string
  sources: PresentationSource[]
  onOpen:  (s: PresentationSource) => void
}

function Citable({ text, sources, onOpen }: CitableProps) {
  const byIdx = new Map(sources.map((s) => [s.idx, s]))
  const parts: React.ReactNode[] = []

  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0

  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const nums = m[1]
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => byIdx.has(n))

    if (nums.length === 0) {
      // No real source behind the marker — drop the marker silently
      // (filterCitations on the backend already does this for fresh runs,
      // but old data might still contain them).
    } else {
      nums.forEach((n, i) => {
        const src = byIdx.get(n)!
        parts.push(
          <button
            key={`c${key++}`}
            type="button"
            onClick={() => onOpen(src)}
            title={`${src.file_name}${formatPages(src)}`}
            className="inline-flex items-center text-[10px] font-sans font-medium px-1.5 py-px rounded-sm bg-amber-light text-amber hover:bg-amber hover:text-white transition-colors align-baseline mx-0.5 cursor-pointer"
          >
            {n}
          </button>
        )
        if (i < nums.length - 1) parts.push(' ')
      })
    }
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts}</>
}

function formatPages(s: PresentationSource): string {
  if (s.page_start == null) return ''
  if (s.page_end && s.page_end !== s.page_start) return ` · стр. ${s.page_start}–${s.page_end}`
  return ` · стр. ${s.page_start}`
}

// ─── Source popover ───────────────────────────────────────────────────────────

function SourceDetail({ source, onClose }: { source: PresentationSource; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-surface rounded-xl w-full max-w-md my-12 shadow-sm border border-border"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <span className="inline-flex items-center justify-center text-[10px] font-sans font-semibold bg-amber text-white w-5 h-5 rounded-sm flex-shrink-0">
            {source.idx}
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-sans font-medium text-ink truncate">{source.file_name}</div>
            {source.page_start != null && (
              <div className="text-[11px] font-sans text-ink-tertiary">
                {source.page_end && source.page_end !== source.page_start
                  ? `Страницы ${source.page_start}–${source.page_end}`
                  : `Страница ${source.page_start}`}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-ink-tertiary hover:text-ink transition-colors text-lg leading-none ml-1"
            aria-label="Закрыть"
          >
            ×
          </button>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Фрагмент из источника
          </div>
          <p className="text-[13px] font-sans text-ink-secondary leading-relaxed whitespace-pre-wrap">
            {source.excerpt}
          </p>
        </div>
      </div>
    </div>
  )
}

// ─── SlideCard ────────────────────────────────────────────────────────────────

interface SlideCardProps {
  slide:   Slide
  sources: PresentationSource[]
  onCite:  (s: PresentationSource) => void
}

function SlideCard({ slide, sources, onCite }: SlideCardProps) {
  const [copied, setCopied] = useState(false)

  function copySlide() {
    const text = [
      `Слайд ${slide.number}: ${slide.title}`,
      '',
      ...slide.bullets.map((b) => `• ${b}`),
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
            <Citable text={slide.title} sources={sources} onOpen={onCite} />
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
        <div className="p-4 border-r border-border space-y-2">
          {slide.bullets.length > 0 ? (
            slide.bullets.map((b, i) => (
              <div key={i} className="flex gap-2 text-sm font-sans text-ink leading-relaxed">
                <span className="text-amber mt-0.5 flex-shrink-0 select-none">•</span>
                <span><Citable text={b} sources={sources} onOpen={onCite} /></span>
              </div>
            ))
          ) : (
            <p className="text-sm font-sans text-ink-tertiary italic">Нет тезисов</p>
          )}
        </div>

        <div className="p-4 bg-surface-warm">
          <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Заметки докладчика
          </div>
          {slide.notes ? (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">
              <Citable text={slide.notes} sources={sources} onOpen={onCite} />
            </p>
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
  sources?: PresentationSource[] | null
}

export default function SlideContent({ content, sources }: Props) {
  const [copiedAll, setCopiedAll] = useState(false)
  const [openSource, setOpenSource] = useState<PresentationSource | null>(null)
  const slides     = parseSlides(content)
  const sourceList = sources ?? []

  function copyAll() {
    navigator.clipboard.writeText(content).then(() => {
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 2000)
    })
  }

  if (slides.length === 0) {
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

      {slides.map((slide) => (
        <SlideCard key={slide.number} slide={slide} sources={sourceList} onCite={setOpenSource} />
      ))}

      {/* Sources legend — listed once at the bottom for the teacher to verify */}
      {sourceList.length > 0 && (
        <div className="mt-6 bg-surface border border-border rounded-lg p-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
            Использованные источники
          </div>
          <div className="space-y-2">
            {sourceList.map((s) => (
              <button
                key={s.idx}
                type="button"
                onClick={() => setOpenSource(s)}
                className="w-full flex items-start gap-2 text-left hover:bg-surface-warm transition-colors px-2 py-1.5 -mx-2 rounded-md"
              >
                <span className="inline-flex items-center justify-center text-[10px] font-sans font-semibold bg-amber-light text-amber w-5 h-5 rounded-sm flex-shrink-0 mt-px">
                  {s.idx}
                </span>
                <span className="text-xs font-sans text-ink-secondary leading-relaxed">
                  <span className="text-ink font-medium">{s.file_name}</span>
                  {s.page_start != null && (
                    <span className="text-ink-tertiary">
                      {' '}·{' '}
                      {s.page_end && s.page_end !== s.page_start
                        ? `стр. ${s.page_start}–${s.page_end}`
                        : `стр. ${s.page_start}`}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {openSource && <SourceDetail source={openSource} onClose={() => setOpenSource(null)} />}
    </div>
  )
}
