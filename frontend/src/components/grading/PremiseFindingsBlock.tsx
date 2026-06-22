import type { PremiseFinding, PremiseFindingKind, ChapterReview, BulletSeverity } from '../../types'

// Tier-5: document-level reasoning findings from the cross-section premise pass.
// Distinct from Tier-2 (numeric name-clusters) and Tier-4 (intra-section
// recomputation): these span sections or test physical/logical plausibility —
// the combustion-equation-vs-composition and phase-equilibrium class of issue.
// Placed above the numeric blocks: a wrong premise invalidates the numbers
// downstream, so it's the first thing the teacher should see.

const SEVERITY_DOT_CLASS: Record<BulletSeverity, string> = {
  critical:    'bg-danger',
  substantial: 'bg-warning',
  minor:       'bg-ink-tertiary',
}

const SEVERITY_LABEL: Record<BulletSeverity, string> = {
  critical:    'критично',
  substantial: 'существенно',
  minor:       'незначительно',
}

const KIND_LABEL: Record<PremiseFindingKind, string> = {
  contradiction: 'Противоречие между разделами',
  physical:      'Неправдоподобное допущение',
  logical:       'Логическая ошибка',
}

interface Props {
  items:    PremiseFinding[]
  chapters: ChapterReview[]
}

export default function PremiseFindingsBlock({ items, chapters }: Props) {
  if (items.length === 0) return null

  const chapterTitle = (idx: number) =>
    chapters[idx]?.title || `Раздел ${idx + 1}`

  const SEVERITY_RANK: Record<BulletSeverity, number> = { critical: 3, substantial: 2, minor: 1 }
  const sorted = [...items].sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity])

  return (
    <section className="bg-danger-bg border border-danger/20 rounded-lg p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-sans font-semibold text-danger uppercase tracking-wider">
          Состоятельность работы
        </span>
        <span className="text-[10px] font-sans text-danger/70 tabular-nums">
          ({items.length})
        </span>
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed mb-3">
        Проблемы, видимые только при взгляде на работу целиком: противоречия между разделами и физически неправдоподобные допущения.
      </p>
      <div className="space-y-3">
        {sorted.map((f, i) => (
          <div key={i} className="bg-surface border border-border rounded-md p-3">
            {/* Header: severity dot + title + kind tag */}
            <div className="flex items-start gap-2 mb-1.5">
              <span
                className={`${SEVERITY_DOT_CLASS[f.severity]} w-2 h-2 rounded-full mt-1.5 flex-shrink-0`}
                title={SEVERITY_LABEL[f.severity]}
                aria-label={`severity: ${SEVERITY_LABEL[f.severity]}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-sans font-medium text-ink leading-snug">
                  {f.title}
                </div>
                <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider mt-0.5">
                  {KIND_LABEL[f.kind]}
                </div>
              </div>
            </div>

            {/* Explanation */}
            <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-2">
              {f.explanation}
            </p>

            {/* Evidence quotes, each tagged with its section */}
            {f.evidence.length > 0 && (
              <div className="space-y-1.5 mb-2">
                {f.evidence.map((e, j) => (
                  <div key={j} className="flex items-start gap-2 text-xs font-sans leading-relaxed">
                    <span className="text-[10px] font-medium text-ink-tertiary uppercase tracking-wider flex-shrink-0 min-w-[110px] pt-0.5">
                      {chapterTitle(e.chapter_index)}
                    </span>
                    <div className="flex-1 min-w-0 flex gap-1 items-start">
                      <span className="text-[10px] text-amber font-medium mt-0.5 flex-shrink-0">↳</span>
                      <span className="text-[11.5px] italic text-ink-tertiary border-l-2 border-amber/30 pl-2">
                        «{e.quote}»
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Corrective action */}
            {f.correction && (
              <div className="flex gap-1.5 text-[11px] font-sans pt-1.5 border-t border-border">
                <span className="text-ink-tertiary flex-shrink-0">Что сделать:</span>
                <span className="text-ink-secondary">{f.correction}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </section>
  )
}
