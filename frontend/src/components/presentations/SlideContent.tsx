import { useState } from 'react'
import type {
  PresentationSource, Slide, SlideImage, TitleSlide, BulletsSlide, ConceptSlide,
  FormulaSlide, ComparisonSlide, DiagramSlide, DiscussionSlide, SummarySlide,
} from '../../types'
import { BlockMath, InlineText } from './Math'
import SlideImagePicker from './SlideImagePicker'
import { slidesToText, legacySlidesToText } from './slideText'
import { slidesToHtml, legacySlidesToHtml } from './slideHtml'
import { copyRich } from './clipboard'
import Button from '../ui/Button'
import CopyAllButton from '../ui/CopyAllButton'
import LoadingSpinner from '../ui/LoadingSpinner'
import SlideEditor from './SlideEditor'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'
import { downloadPresentationPptx } from '../../api/presentations'

// ─── PPTX export (TODO.md Feature D) ───────────────────────────────────────
//
// Only shown for a persisted presentation with the typed slide array — a
// legacy text-DSL row (no `slides`) has nothing structured to export from.
// Pro-gated (`pptxExport`): generation itself stays available on Free, the
// native .pptx download is the differentiator.

const DownloadIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <path d="M7 10l5 5 5-5" /><path d="M12 15V3" />
  </svg>
)

function PptxDownloadButton({ presentationId }: { presentationId: string }) {
  const { can } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const [downloading, setDownloading] = useState(false)

  async function handleClick() {
    if (!can('pptxExport')) { showUpgradeModal('FEATURE_NOT_IN_PLAN'); return }
    setDownloading(true)
    try {
      await downloadPresentationPptx(presentationId)
    } finally {
      setDownloading(false)
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={downloading}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface border border-border-mid text-xs font-sans font-medium text-ink-secondary shadow-sm whitespace-nowrap shrink-0 hover:border-amber hover:text-amber transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {downloading ? <LoadingSpinner size={13} /> : <DownloadIcon />}
      {downloading ? 'Экспортируем…' : 'Скачать PPTX'}
    </button>
  )
}

// ─── RichText ─────────────────────────────────────────────────────────────────
//
// Walks a string and emits citation chips for [N] / [N, M] markers and KaTeX
// math runs ($inline$ and $$block$$) interspersed with plain text. Built once
// here so every per-type renderer can hand it a body field and trust the
// output. Math gets first split, then we walk each text run for citations.

interface RichTextProps {
  text:    string
  sources: PresentationSource[]
  onOpen:  (s: PresentationSource) => void
}

function RichText({ text, sources, onOpen }: RichTextProps) {
  const byIdx = new Map(sources.map((s) => [s.idx, s]))

  // Pass 1: math-aware tokenisation
  const segments = splitMath(text)

  return (
    <>
      {segments.map((seg, segIdx) => {
        if (seg.kind === 'math') {
          // Block math gets its own line; inline math sits in the run.
          return seg.block
            ? <BlockMath key={segIdx} latex={seg.body} />
            : <InlineText key={segIdx} text={`$${seg.body}$`} />
        }
        // Pass 2: walk for citation markers inside this plain-text run.
        return <CitationRun key={segIdx} text={seg.body} byIdx={byIdx} onOpen={onOpen} />
      })}
    </>
  )
}

// Lightweight version of the math splitter from Math.tsx — kept inline here
// so we can route block math to its own line while letting inline math reuse
// InlineText's mixed renderer.
interface MathSegment { kind: 'text' | 'math'; body: string; block: boolean }
function splitMath(text: string): MathSegment[] {
  const out: MathSegment[] = []
  let i = 0
  while (i < text.length) {
    const dollar = text.indexOf('$', i)
    if (dollar === -1) { out.push({ kind: 'text', body: text.slice(i), block: false }); break }
    if (dollar > i)   { out.push({ kind: 'text', body: text.slice(i, dollar), block: false }) }
    if (text[dollar + 1] === '$') {
      const close = text.indexOf('$$', dollar + 2)
      if (close === -1) { out.push({ kind: 'text', body: text.slice(dollar), block: false }); break }
      out.push({ kind: 'math', body: text.slice(dollar + 2, close), block: true })
      i = close + 2
    } else {
      // For inline math, leave the delimiters in so InlineText renders it.
      const close = text.indexOf('$', dollar + 1)
      if (close === -1) { out.push({ kind: 'text', body: text.slice(dollar), block: false }); break }
      out.push({ kind: 'math', body: text.slice(dollar + 1, close), block: false })
      i = close + 1
    }
  }
  return out
}

interface CitationRunProps {
  text:   string
  byIdx:  Map<number, PresentationSource>
  onOpen: (s: PresentationSource) => void
}
function CitationRun({ text, byIdx, onOpen }: CitationRunProps) {
  const parts: React.ReactNode[] = []
  const re = /\[(\d+(?:\s*,\s*\d+)*)\]/g
  let last = 0
  let m: RegExpExecArray | null
  let key = 0
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    const nums = m[1].split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => byIdx.has(n))
    nums.forEach((n, i) => {
      const src = byIdx.get(n)!
      parts.push(
        <button
          key={`c${key++}`}
          type="button"
          onClick={() => onOpen(src)}
          title={`${src.file_name}${formatPages(src)}`}
          className="inline-flex items-center text-[10px] font-sans font-medium px-1.5 py-px rounded-sm bg-amber-light text-amber hover:bg-amber hover:text-white transition-colors align-baseline mx-0.5 cursor-pointer"
        >{n}</button>
      )
      if (i < nums.length - 1) parts.push(' ')
    })
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

// ─── Source detail popover ────────────────────────────────────────────────────

function SourceDetail({ source, onClose }: { source: PresentationSource; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-surface rounded-xl w-full max-w-md my-12 shadow-sm border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border">
          <span className="inline-flex items-center justify-center text-[10px] font-sans font-semibold bg-amber text-white w-5 h-5 rounded-sm flex-shrink-0">{source.idx}</span>
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
          <button onClick={onClose} className="text-ink-tertiary hover:text-ink transition-colors text-lg leading-none ml-1" aria-label="Закрыть">×</button>
        </div>
        <div className="px-5 py-4">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">Фрагмент из источника</div>
          <p className="text-[13px] font-sans text-ink-secondary leading-relaxed whitespace-pre-wrap">{source.excerpt}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Per-type renderers ───────────────────────────────────────────────────────
//
// Each renderer returns the body block of the slide card (the title bar +
// notes pane wrap them in SlideCard). Each picks the layout that suits the
// content — that's the whole point of the typed format. They reuse RichText
// for any field that can carry markers or math.

interface BodyProps<T> {
  slide:   T
  sources: PresentationSource[]
  onCite:  (s: PresentationSource) => void
}

function TitleBody({ slide }: BodyProps<TitleSlide>) {
  return (
    <div className="p-6 text-center">
      {slide.body.subtitle && (
        <div className="font-sans text-sm text-ink-secondary">{slide.body.subtitle}</div>
      )}
      <h2 className="font-display text-2xl font-bold text-ink mt-2">{slide.title}</h2>
      {slide.body.lecturer && (
        <div className="font-sans text-xs text-ink-tertiary mt-4">{slide.body.lecturer}</div>
      )}
    </div>
  )
}

function BulletsBody({ slide, sources, onCite }: BodyProps<BulletsSlide>) {
  return (
    <div className="p-4 space-y-2">
      {slide.body.items.length > 0
        ? slide.body.items.map((b, i) => (
            <div key={i} className="flex gap-2 text-sm font-sans text-ink leading-relaxed">
              <span className="text-amber mt-0.5 flex-shrink-0 select-none">•</span>
              <span><RichText text={b} sources={sources} onOpen={onCite} /></span>
            </div>
          ))
        : <p className="text-sm font-sans text-ink-tertiary italic">Нет тезисов</p>}
    </div>
  )
}

function ConceptBody({ slide, sources, onCite }: BodyProps<ConceptSlide>) {
  return (
    <div className="p-4">
      <div className="text-[15px] font-sans text-ink leading-relaxed mb-3 border-l-2 border-amber pl-3">
        <RichText text={slide.body.definition} sources={sources} onOpen={onCite} />
      </div>
      {slide.body.supporting.length > 0 && (
        <div className="space-y-1.5">
          {slide.body.supporting.map((s, i) => (
            <div key={i} className="flex gap-2 text-[13px] font-sans text-ink-secondary leading-relaxed">
              <span className="text-amber mt-0.5 flex-shrink-0 select-none">·</span>
              <span><RichText text={s} sources={sources} onOpen={onCite} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FormulaBody({ slide, sources, onCite }: BodyProps<FormulaSlide>) {
  return (
    <div className="p-4">
      <div className="bg-surface-warm rounded-md py-3 px-4 space-y-3">
        {slide.body.formulas.map((f, i) => (
          <div key={i}>
            <BlockMath latex={f.latex} />
            {f.caption && (
              <div className="text-[11px] font-sans text-ink-tertiary text-center mt-1">
                <RichText text={f.caption} sources={sources} onOpen={onCite} />
              </div>
            )}
          </div>
        ))}
      </div>
      {slide.body.explanation && (
        <p className="text-[13px] font-sans text-ink-secondary leading-relaxed mt-3">
          <RichText text={slide.body.explanation} sources={sources} onOpen={onCite} />
        </p>
      )}
    </div>
  )
}

function ComparisonBody({ slide, sources, onCite }: BodyProps<ComparisonSlide>) {
  const cols = slide.body.columns
  // Keep grid simple regardless of column count (2 or 3 supported).
  const gridStyle = { gridTemplateColumns: `repeat(${cols.length}, minmax(0, 1fr))` }
  return (
    <div className="p-4">
      <div className="grid gap-3" style={gridStyle}>
        {cols.map((c, i) => (
          <div key={i} className="border border-border rounded-md overflow-hidden">
            <div className="px-3 py-1.5 bg-surface-warm text-[11px] font-sans font-semibold text-ink uppercase tracking-wide border-b border-border">
              <RichText text={c.header} sources={sources} onOpen={onCite} />
            </div>
            <div className="p-3 space-y-1.5">
              {c.items.map((it, j) => (
                <div key={j} className="flex gap-1.5 text-[12px] font-sans text-ink leading-relaxed">
                  <span className="text-amber mt-0.5 flex-shrink-0 select-none">·</span>
                  <span><RichText text={it} sources={sources} onOpen={onCite} /></span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Shared image slot — a picked image + swap link, or an empty dashed slot
// with the model's suggested query + a search trigger. Used by DiagramBody
// (its native slot) and, since TODO.md Feature AG Phase 2, appended below
// any other slide type that carries a top-level image_query/image (see
// renderBody below).
function SlideImageBlock({
  image, query, altText, presentationId, slideIdx, onImageChange,
}: {
  image:          SlideImage | null
  query:          string
  altText:        string
  presentationId: string
  slideIdx:       number
  onImageChange:  (image: SlideImage | null) => void
}) {
  return image ? (
    <div className="mb-3">
      <div className="bg-surface-warm rounded-md p-2 border border-border flex items-center justify-center">
        <img
          src={image.thumbnail || image.url}
          alt={altText}
          loading="lazy"
          className="max-h-72 w-auto rounded-sm object-contain"
        />
      </div>
      <div className="flex items-center justify-between mt-1.5 px-1">
        <a
          href={image.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] font-sans text-ink-tertiary hover:text-amber transition-colors"
        >
          Источник: {image.source_host || image.source_url}
        </a>
        <SlideImagePicker
          presentationId={presentationId}
          slideIdx={slideIdx}
          query={query}
          onPick={onImageChange}
          triggerLabel="Заменить"
        />
      </div>
    </div>
  ) : (
    <div className="mb-3">
      <div className="bg-surface-warm border border-dashed border-border rounded-md p-4 flex flex-col items-center justify-center gap-2 min-h-[120px]">
        <div className="text-[11px] font-sans text-ink-tertiary uppercase tracking-wider">Изображение не выбрано</div>
        {query && (
          <div className="text-xs font-sans text-ink-secondary text-center italic">«{query}»</div>
        )}
        <SlideImagePicker
          presentationId={presentationId}
          slideIdx={slideIdx}
          query={query}
          onPick={onImageChange}
          triggerLabel="Найти изображение"
        />
      </div>
    </div>
  )
}

function DiagramBody({
  slide, sources, onCite, presentationId, slideIdx, onImageChange,
}: BodyProps<DiagramSlide> & {
  presentationId: string
  slideIdx: number
  onImageChange: (image: SlideImage | null) => void
}) {
  return (
    <div className="p-4">
      <SlideImageBlock
        image={slide.body.image}
        query={slide.body.image_query}
        altText={slide.body.caption || slide.title}
        presentationId={presentationId}
        slideIdx={slideIdx}
        onImageChange={onImageChange}
      />

      {slide.body.caption && (
        <div className="text-[13px] font-sans font-medium text-ink mb-2">
          <RichText text={slide.body.caption} sources={sources} onOpen={onCite} />
        </div>
      )}
      {slide.body.points.length > 0 && (
        <div className="space-y-1.5">
          {slide.body.points.map((p, i) => (
            <div key={i} className="flex gap-2 text-[13px] font-sans text-ink-secondary leading-relaxed">
              <span className="text-amber mt-0.5 flex-shrink-0 select-none">·</span>
              <span><RichText text={p} sources={sources} onOpen={onCite} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DiscussionBody({ slide, sources, onCite }: BodyProps<DiscussionSlide>) {
  return (
    <div className="p-4">
      <div className="text-[15px] font-display font-bold text-ink leading-snug mb-3">
        <RichText text={slide.body.question} sources={sources} onOpen={onCite} />
      </div>
      {slide.body.prompts.length > 0 && (
        <div className="space-y-1.5">
          {slide.body.prompts.map((p, i) => (
            <div key={i} className="flex gap-2 text-[13px] font-sans text-ink leading-relaxed">
              <span className="text-amber mt-0.5 flex-shrink-0 select-none">→</span>
              <span><RichText text={p} sources={sources} onOpen={onCite} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SummaryBody({ slide, sources, onCite }: BodyProps<SummarySlide>) {
  return (
    <div className="p-4 space-y-3">
      {slide.body.takeaways.length > 0 && (
        <div>
          <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5">Главное</div>
          {slide.body.takeaways.map((t, i) => (
            <div key={i} className="flex gap-2 text-sm font-sans text-ink leading-relaxed">
              <span className="text-amber mt-0.5 flex-shrink-0 select-none">•</span>
              <span><RichText text={t} sources={sources} onOpen={onCite} /></span>
            </div>
          ))}
        </div>
      )}
      {slide.body.next_steps.length > 0 && (
        <div>
          <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5">Что дальше</div>
          {slide.body.next_steps.map((t, i) => (
            <div key={i} className="flex gap-2 text-[13px] font-sans text-ink-secondary leading-relaxed">
              <span className="text-amber mt-0.5 flex-shrink-0 select-none">→</span>
              <span><RichText text={t} sources={sources} onOpen={onCite} /></span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── TypedSlideCard ───────────────────────────────────────────────────────────
//
// Wraps any typed slide in the common card shell (header + body + speaker notes).
// Dispatches body rendering by `slide.type`.

interface TypedSlideCardProps {
  slide:          Slide
  slideIdx:       number          // 0-based index inside the deck
  slideNumber:    number          // 1-based human number shown to teacher
  sources:        PresentationSource[]
  onCite:         (s: PresentationSource) => void
  presentationId: string
  onImageChange:  (slideIdx: number, image: SlideImage | null) => void
  // Slide-level editing (TODO.md "### AO" Phase 1). Absent when the deck has
  // no id to write to (a result rendered before it was persisted, or the
  // legacy path), in which case the card stays read-only as it always was.
  edit?:          SlideEditActions
  isFirst:        boolean
  isLast:         boolean
}

export interface SlideEditActions {
  busy:         boolean
  onSave:       (slideIdx: number, slide: Slide) => void
  onRegenerate: (slideIdx: number, instruction: string) => void
  onDelete:     (slideIdx: number) => void
  onMove:       (slideIdx: number, to: number) => void
  // Appends an empty slide. Empty on purpose: the teacher types into it or
  // hits «Переписать», which writes it from its type + title the same way
  // every other slide was written.
  onInsert:     (afterIdx: number) => void
}

function TypedSlideCard({
  slide, slideIdx, slideNumber, sources, onCite, presentationId, onImageChange,
  edit, isFirst, isLast,
}: TypedSlideCardProps) {
  const [copied, setCopied] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit' | 'regenerate'>('view')
  const [instruction, setInstruction] = useState('')
  function copy() {
    const html = slidesToHtml([slide], slideNumber)
    const text = slidesToText([slide], slideNumber)
    void copyRich(html, text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] font-sans font-semibold bg-amber-light text-amber px-2 py-0.5 rounded-sm flex-shrink-0 uppercase tracking-wide">
            Слайд {slideNumber}
          </span>
          <span className="text-[10px] font-sans font-medium text-ink-tertiary uppercase tracking-wide flex-shrink-0">
            {slideTypeLabel(slide.type)}
          </span>
          {slide.type !== 'title' && (
            <h3 className="font-display text-[15px] font-bold text-ink truncate">
              <RichText text={slide.title} sources={sources} onOpen={onCite} />
            </h3>
          )}
        </div>
        <div className="flex items-center gap-2.5 flex-shrink-0 ml-3">
          {edit && (
            <>
              <SlideAction label="Выше"  disabled={isFirst || edit.busy} onClick={() => edit.onMove(slideIdx, slideIdx - 1)}>↑</SlideAction>
              <SlideAction label="Ниже"  disabled={isLast  || edit.busy} onClick={() => edit.onMove(slideIdx, slideIdx + 1)}>↓</SlideAction>
              <button
                onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}
                disabled={edit.busy}
                className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors disabled:opacity-40"
              >
                {mode === 'edit' ? 'Закрыть' : 'Изменить'}
              </button>
              <button
                onClick={() => setMode(mode === 'regenerate' ? 'view' : 'regenerate')}
                disabled={edit.busy}
                className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors disabled:opacity-40"
              >
                Переписать
              </button>
              <button
                onClick={() => edit.onDelete(slideIdx)}
                disabled={edit.busy}
                className="text-xs font-sans text-ink-tertiary hover:text-danger transition-colors disabled:opacity-40"
              >
                Удалить
              </button>
            </>
          )}
          <button
            onClick={copy}
            className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors"
          >
            {copied ? '✓ Скопировано' : 'Копировать'}
          </button>
        </div>
      </div>

      {edit && mode === 'regenerate' && (
        <div className="p-4 bg-surface-warm border-b border-border space-y-2">
          <label className="block text-[11px] font-sans font-medium text-ink-secondary">
            Что поправить? Можно оставить пустым — тогда слайд просто перепишется заново.
          </label>
          <div className="flex gap-2">
            <input
              className="flex-1 px-2.5 py-1.5 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Короче, и добавь пример с реальными числами"
              maxLength={500}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); edit.onRegenerate(slideIdx, instruction.trim()) }
              }}
            />
            <Button size="sm" loading={edit.busy} onClick={() => edit.onRegenerate(slideIdx, instruction.trim())}>
              Переписать
            </Button>
          </div>
        </div>
      )}

      {edit && mode === 'edit' && (
        <SlideEditor
          slide={slide}
          saving={edit.busy}
          onCancel={() => setMode('view')}
          onSave={(edited) => { edit.onSave(slideIdx, edited); setMode('view') }}
        />
      )}

      <div className="grid grid-cols-[3fr_2fr]">
        <div className="border-r border-border">
          {renderBody({
            slide, slideIdx, sources, onCite, presentationId,
            onImageChange: (image) => onImageChange(slideIdx, image),
          })}
        </div>
        <div className="p-4 bg-surface-warm">
          <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
            Заметки докладчика
          </div>
          {slide.notes ? (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">
              <RichText text={slide.notes} sources={sources} onOpen={onCite} />
            </p>
          ) : (
            <p className="text-xs font-sans text-ink-tertiary italic">—</p>
          )}
        </div>
      </div>
    </div>
  )
}

interface RenderBodyArgs {
  slide:          Slide
  slideIdx:       number
  sources:        PresentationSource[]
  onCite:         (s: PresentationSource) => void
  presentationId: string
  onImageChange:  (image: SlideImage | null) => void
}

function renderBody(args: RenderBodyArgs): React.ReactNode {
  const { slide, sources, onCite, presentationId, slideIdx, onImageChange } = args
  const body = (() => {
    switch (slide.type) {
      case 'title':      return <TitleBody slide={slide} sources={sources} onCite={onCite} />
      case 'bullets':    return <BulletsBody slide={slide} sources={sources} onCite={onCite} />
      case 'concept':    return <ConceptBody slide={slide} sources={sources} onCite={onCite} />
      case 'formula':    return <FormulaBody slide={slide} sources={sources} onCite={onCite} />
      case 'comparison': return <ComparisonBody slide={slide} sources={sources} onCite={onCite} />
      case 'diagram':    return (
        <DiagramBody
          slide={slide} sources={sources} onCite={onCite}
          presentationId={presentationId} slideIdx={slideIdx} onImageChange={onImageChange}
        />
      )
      case 'discussion': return <DiscussionBody slide={slide} sources={sources} onCite={onCite} />
      case 'summary':    return <SummaryBody slide={slide} sources={sources} onCite={onCite} />
    }
  })()

  // Non-diagram slides can carry a supplementary top-level image (TODO.md
  // Feature AG Phase 2) — diagram already renders its own inline above, via
  // DiagramBody.
  if (slide.type === 'diagram') return body

  // Model suggested a query (or the teacher already picked one) — full slot.
  if (slide.image_query || slide.image) {
    return (
      <>
        {body}
        <div className="px-4 pb-4">
          <SlideImageBlock
            image={slide.image ?? null}
            query={slide.image_query ?? ''}
            altText={slide.title}
            presentationId={presentationId}
            slideIdx={slideIdx}
            onImageChange={onImageChange}
          />
        </div>
      </>
    )
  }

  // No suggested image on a content slide (title/summary excluded — a
  // picture rarely helps either) — a minimal link, not the full dashed box,
  // so slides the model correctly judged didn't need one stay uncluttered.
  // Lets a teacher add an image anywhere the model didn't (backend route
  // already accepts a manual override query — see routes/presentations.ts).
  if (slide.type !== 'title' && slide.type !== 'summary') {
    return (
      <>
        {body}
        <div className="px-4 pb-4">
          <SlideImagePicker
            presentationId={presentationId}
            slideIdx={slideIdx}
            query=""
            onPick={onImageChange}
            triggerLabel="+ Добавить изображение"
          />
        </div>
      </>
    )
  }

  return body
}

function SlideAction({
  children, label, onClick, disabled,
}: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="w-5 h-5 flex items-center justify-center rounded-sm text-sm leading-none text-ink-tertiary hover:text-ink hover:bg-surface-warm transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}

function slideTypeLabel(type: Slide['type']): string {
  switch (type) {
    case 'title':      return 'Титул'
    case 'bullets':    return 'Тезисы'
    case 'concept':    return 'Понятие'
    case 'formula':    return 'Формула'
    case 'comparison': return 'Сравнение'
    case 'diagram':    return 'Схема'
    case 'discussion': return 'Обсуждение'
    case 'summary':    return 'Итоги'
  }
}

// ─── Legacy text-DSL renderer ─────────────────────────────────────────────────
//
// Old presentations stored their slide content as text (СЛАЙД N: ... bullets
// ... ЗАМЕТКИ ДОКЛАДЧИКА: ...). We keep the parser around verbatim so already-
// generated rows still render. No backfill — old rows stay in text format.

interface LegacySlide { number: number; title: string; bullets: string[]; notes: string }

function parseLegacy(content: string): LegacySlide[] {
  const sections = content.split(/\n---\n/).map((s) => s.trim()).filter(Boolean)
  const slides: LegacySlide[] = []
  for (const section of sections) {
    const headerMatch = section.match(/^(?:СЛАЙД|SLIDE)\s+(\d+):\s*(.+)$/im)
    if (!headerMatch) continue
    const number = parseInt(headerMatch[1], 10)
    const title  = headerMatch[2].trim()
    const notesMatch = section.match(/(?:ЗАМЕТКИ ДОКЛАДЧИКА|SPEAKER NOTES):\n([\s\S]+?)(?:\n---|\s*$)/i)
    const notes = notesMatch ? notesMatch[1].trim() : ''
    const headerEnd  = section.indexOf('\n')
    const notesStart = notesMatch ? section.indexOf(notesMatch[0]) : section.length
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

function LegacySlideCard({
  slide, sources, onCite,
}: {
  slide: LegacySlide
  sources: PresentationSource[]
  onCite: (s: PresentationSource) => void
}) {
  const [copied, setCopied] = useState(false)
  function copy() {
    const html = legacySlidesToHtml([slide])
    const text = legacySlidesToText([slide])
    void copyRich(html, text).then((ok) => {
      if (!ok) return
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="text-[10px] font-sans font-semibold bg-amber-light text-amber px-2 py-0.5 rounded-sm flex-shrink-0 uppercase tracking-wide">
            Слайд {slide.number}
          </span>
          <h3 className="font-display text-[15px] font-bold text-ink truncate">
            <RichText text={slide.title} sources={sources} onOpen={onCite} />
          </h3>
        </div>
        <button onClick={copy} className="ml-3 text-xs font-sans text-ink-secondary hover:text-amber transition-colors flex-shrink-0">
          {copied ? '✓ Скопировано' : 'Копировать'}
        </button>
      </div>
      <div className="grid grid-cols-[3fr_2fr]">
        <div className="p-4 border-r border-border space-y-2">
          {slide.bullets.length > 0
            ? slide.bullets.map((b, i) => (
                <div key={i} className="flex gap-2 text-sm font-sans text-ink leading-relaxed">
                  <span className="text-amber mt-0.5 flex-shrink-0 select-none">•</span>
                  <span><RichText text={b} sources={sources} onOpen={onCite} /></span>
                </div>
              ))
            : <p className="text-sm font-sans text-ink-tertiary italic">Нет тезисов</p>}
        </div>
        <div className="p-4 bg-surface-warm">
          <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">Заметки докладчика</div>
          {slide.notes ? (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">
              <RichText text={slide.notes} sources={sources} onOpen={onCite} />
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
  // Either: pass `slides` (new format — typed array). Diagram slides can be
  // edited (image picker) iff `presentationId` is given and `onSlidesChange`
  // wires through.
  slides?:          Slide[] | null
  presentationId?:  string
  onSlidesChange?:  (slides: Slide[]) => void
  // Slide-level editing (TODO.md "### AO" Phase 1). Passed by the page, which
  // owns the API calls; without it the viewer is read-only exactly as before.
  edit?:            SlideEditActions
  // Or: pass `content` (legacy text-DSL fallback).
  content?:         string
  sources?:         PresentationSource[] | null
}

export default function SlideContent({
  slides, presentationId, onSlidesChange, content, sources, edit,
}: Props) {
  const [openSource, setOpenSource] = useState<PresentationSource | null>(null)
  const sourceList = sources ?? []

  // Prefer the typed array. Only fall back to the text parser when we have
  // text and no structured slides (i.e., old presentations).
  const useTyped = Array.isArray(slides) && slides.length > 0
  const legacySlides = !useTyped && content ? parseLegacy(content) : []

  function copyAll() {
    const html = useTyped
      ? slidesToHtml(slides!)
      : legacySlidesToHtml(legacySlides)
    const text = useTyped
      ? slidesToText(slides!)
      : legacySlidesToText(legacySlides)
    return copyRich(html, text)
  }

  function handleImageChange(slideIdx: number, image: SlideImage | null) {
    if (!useTyped || !onSlidesChange) return
    // Mirrors setSlideImage's storage split (db/queries/presentations.ts):
    // diagram keeps body.image, every other type uses the top-level field.
    const next = slides!.map((s, i) => {
      if (i !== slideIdx) return s
      return s.type === 'diagram'
        ? { ...s, body: { ...s.body, image } }
        : { ...s, image }
    })
    onSlidesChange(next)
  }

  const totalSlides = useTyped ? slides!.length : legacySlides.length

  if (!useTyped && legacySlides.length === 0) {
    // Neither format — show raw content as a fallback (e.g. parse failure).
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
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          {totalSlides} слайдов
        </div>
        <div className="flex items-center gap-2">
          <CopyAllButton onCopy={copyAll} />
          {useTyped && presentationId && <PptxDownloadButton presentationId={presentationId} />}
        </div>
      </div>

      {useTyped
        ? slides!.map((s, i) => (
            <TypedSlideCard
              key={i}
              slide={s}
              slideIdx={i}
              slideNumber={i + 1}
              sources={sourceList}
              onCite={setOpenSource}
              presentationId={presentationId ?? ''}
              onImageChange={handleImageChange}
              edit={presentationId ? edit : undefined}
              isFirst={i === 0}
              isLast={i === slides!.length - 1}
            />
          ))
        : legacySlides.map((s) => (
            <LegacySlideCard
              key={s.number}
              slide={s}
              sources={sourceList}
              onCite={setOpenSource}
            />
          ))
      }

      {useTyped && presentationId && edit && (
        <button
          type="button"
          onClick={() => edit.onInsert(slides!.length - 1)}
          disabled={edit.busy}
          className="w-full py-2.5 mb-4 text-xs font-sans text-ink-secondary border border-dashed border-border rounded-lg hover:text-amber hover:border-amber transition-colors disabled:opacity-40"
        >
          + Добавить слайд в конец
        </button>
      )}

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
