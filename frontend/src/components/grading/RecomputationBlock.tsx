import type { RecomputationFinding, ChapterReview, BulletSeverity } from '../../types'

// Tier-4: surfaces headline numerical results where the reasoner's
// independent re-derivation diverges from the author's value. Higher-effort
// signal than Tier-2 cross-section consistency: this is *intra*-section
// arithmetic/method check via the reasoning model, not a name-based cluster.
//
// Visual placement: between Inconsistencies and CoverageNote. Same family of
// "things that need verification" but a different category — claimed vs.
// recomputed sits side-by-side here, whereas inconsistencies show several
// section locations where the same name disagrees.

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

interface Props {
  items:    RecomputationFinding[]
  chapters: ChapterReview[]
}

export default function RecomputationBlock({ items, chapters }: Props) {
  if (items.length === 0) return null

  const chapterTitle = (idx: number) =>
    chapters[idx]?.title || `Раздел ${idx + 1}`

  // Sort by severity DESC inside the block, then by chapter order, so critical
  // arithmetic findings rise to the top of the eye.
  const SEVERITY_RANK: Record<BulletSeverity, number> = { critical: 3, substantial: 2, minor: 1 }
  const sorted = [...items].sort((a, b) =>
    SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.chapter_index - b.chapter_index
  )

  return (
    <section className="bg-danger-bg/60 border border-danger/20 rounded-lg p-3.5">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[10px] font-sans font-semibold text-danger uppercase tracking-wider">
          Перерасчёт результатов
        </span>
        <span className="text-[10px] font-sans text-danger/70 tabular-nums">
          ({items.length})
        </span>
      </div>
      <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed mb-3">
        ИИ независимо пересчитал ключевые численные результаты — ниже расхождения с тем, что написано в работе.
      </p>
      <div className="space-y-3">
        {sorted.map((f, i) => (
          <div key={i} className="bg-surface border border-border rounded-md p-3">
            {/* Header row: severity dot + claim + chapter location */}
            <div className="flex items-start gap-2 mb-2">
              <span
                className={`${SEVERITY_DOT_CLASS[f.severity]} w-2 h-2 rounded-full mt-1.5 flex-shrink-0`}
                title={SEVERITY_LABEL[f.severity]}
                aria-label={`severity: ${SEVERITY_LABEL[f.severity]}`}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-sans font-medium text-ink leading-snug">
                  {f.claim}
                </div>
                <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider mt-0.5">
                  {chapterTitle(f.chapter_index)}
                </div>
              </div>
            </div>

            {/* Claimed vs recomputed side-by-side */}
            <div className="grid grid-cols-2 gap-2 mb-2">
              <div className="bg-warning-bg/60 border border-warning/15 rounded p-2">
                <div className="text-[10px] font-sans font-medium text-warning uppercase tracking-wider mb-0.5">
                  В работе
                </div>
                <div className="text-xs font-sans font-medium text-ink tabular-nums">
                  {f.claimed_value}
                </div>
              </div>
              <div className="bg-success-bg/60 border border-success/15 rounded p-2">
                <div className="text-[10px] font-sans font-medium text-success uppercase tracking-wider mb-0.5">
                  Перерасчёт ИИ
                </div>
                <div className="text-xs font-sans font-medium text-ink tabular-nums">
                  {f.recomputed_value}
                </div>
              </div>
            </div>

            {/* Discrepancy explanation */}
            <p className="text-xs font-sans text-ink-secondary leading-relaxed mb-2">
              {f.discrepancy}
            </p>

            {/* Inputs + formula, when the model provided them */}
            {(f.formula || f.inputs) && (
              <div className="space-y-0.5 mb-2 text-[11px] font-sans">
                {f.formula && (
                  <div className="flex gap-1.5">
                    <span className="text-ink-tertiary flex-shrink-0">Формула:</span>
                    <span className="font-mono text-ink-secondary">{f.formula}</span>
                  </div>
                )}
                {f.inputs && (
                  <div className="flex gap-1.5">
                    <span className="text-ink-tertiary flex-shrink-0">Входы:</span>
                    <span className="text-ink-secondary">{f.inputs}</span>
                  </div>
                )}
              </div>
            )}

            {/* Quote — the line in the work that contains the claimed value */}
            <div className="flex gap-1 items-start">
              <span className="text-[10px] text-amber font-medium mt-0.5 flex-shrink-0">↳</span>
              <span className="text-[11.5px] italic text-ink-tertiary leading-relaxed border-l-2 border-amber/30 pl-2">
                «{f.quote}»
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
