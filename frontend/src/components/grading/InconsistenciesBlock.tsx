import type { Inconsistency, ChapterReview } from '../../types'

// Tier-2: surfaces cross-section quantitative contradictions detected by the
// post-synthesis consistency pass. High-signal block — placed above the
// chapter reviews so the teacher sees it before drilling in. Hidden when
// empty so legacy review rows render unchanged.
interface Props {
  items:     Inconsistency[]
  chapters:  ChapterReview[]
  // Feature N — чертежи appended after chapters; an occurrence chapter_index
  // >= chapters.length refers to drawings[idx - chapters.length], not a
  // written section. Optional so legacy call sites without drawings compile
  // unchanged.
  drawings?: Array<{ title: string }>
}

export default function InconsistenciesBlock({ items, chapters, drawings = [] }: Props) {
  if (items.length === 0) return null

  const chapterTitle = (idx: number) =>
    chapters[idx]?.title || drawings[idx - chapters.length]?.title || `Раздел ${idx + 1}`

  return (
    <section className="bg-danger-bg border border-danger/20 rounded-lg p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-sans font-semibold text-danger uppercase tracking-wider">
          Противоречия в данных
        </span>
        <span className="text-[10px] font-sans text-danger/70 tabular-nums">
          ({items.length})
        </span>
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed mb-3">
        Одна и та же величина встречается в разных разделах с несовместимыми значениями. Проверьте, какое верное.
      </p>
      <div className="space-y-3">
        {items.map((inc, i) => (
          <div key={i} className="bg-surface border border-border rounded-md p-3">
            <div className="text-sm font-sans font-medium text-ink mb-1">
              {inc.name}
            </div>
            <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-2">
              {inc.summary}
            </p>
            <div className="space-y-1.5">
              {inc.occurrences.map((o, j) => (
                <div key={j} className="flex items-start gap-2 text-xs font-sans leading-relaxed">
                  <span className="text-[10px] font-medium text-ink-tertiary uppercase tracking-wider flex-shrink-0 min-w-[110px] pt-0.5">
                    {chapterTitle(o.chapter_index)}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-medium text-ink">{o.value}</span>
                    <div className="mt-0.5 flex gap-1 items-start">
                      <span className="text-[10px] text-amber font-medium mt-0.5 flex-shrink-0">↳</span>
                      <span className="text-[11.5px] italic text-ink-tertiary border-l-2 border-amber/30 pl-2">
                        «{o.quote}»
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
