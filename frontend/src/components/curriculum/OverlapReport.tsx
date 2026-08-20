import type { CurriculumAnalysis, OverlapPair, OverlapType } from '../../types'

// Renders a CurriculumAnalysis — the topic-overlap report from
// POST /api/curriculum/overlap. Extracted from Curriculum.tsx (TODO Feature
// AM, Phase 1) so Кабинет методиста can run the same check across a
// programme's disciplines and render the identical report, instead of
// importing the whole teacher-facing page.

// Display metadata for each overlap class. Order = how strongly it matters.
const TYPE_META: Record<OverlapType, { label: string; badge: string; order: number }> = {
  duplicate: { label: 'Дублирование',          badge: 'bg-danger-bg text-danger',   order: 0 },
  partial:   { label: 'Частичное пересечение', badge: 'bg-warning-bg text-warning', order: 1 },
  adjacent:  { label: 'Смежные темы',          badge: 'bg-success-bg text-success', order: 2 },
}

function simColor(sim: number): string {
  if (sim >= 0.88) return 'var(--color-danger)'
  if (sim >= 0.80) return 'var(--color-warning)'
  return 'var(--color-ink-secondary)'
}

export default function OverlapReport({ result }: { result: CurriculumAnalysis }) {
  const { analyzed, skipped, pairs, pair_summary } = result

  // Group pairs by overlap_type; unclassified fall into "other".
  const grouped = [...pairs].sort((a, b) => {
    const oa = a.overlap_type ? TYPE_META[a.overlap_type].order : 9
    const ob = b.overlap_type ? TYPE_META[b.overlap_type].order : 9
    return oa - ob || b.similarity - a.similarity
  })

  return (
    <div className="result-appear space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Stat label="Дисциплин проанализировано" value={analyzed.length} />
        <Stat label="Найдено пересечений" value={pairs.length} />
        <Stat label="Пар дисциплин с пересечением" value={pair_summary.length} />
      </div>

      {/* Skipped notice */}
      {skipped.length > 0 && (
        <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
          <div className="text-xs font-semibold text-warning uppercase tracking-wide mb-2">
            Пропущены ({skipped.length})
          </div>
          {skipped.map((s) => (
            <div key={s.course_id} className="text-xs font-sans text-warning mb-1 leading-relaxed">
              <span className="font-medium">{s.course_name}</span> — {s.reason}
            </div>
          ))}
        </div>
      )}

      {/* Discipline-pair rollup */}
      {pair_summary.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="px-4 py-3 border-b border-border text-sm font-sans font-medium text-ink">
            Пары дисциплин по силе пересечения
          </div>
          <div className="divide-y divide-border">
            {pair_summary.map((p) => (
              <div key={`${p.course_a_id}|${p.course_b_id}`} className="px-4 py-2.5 flex items-center gap-3">
                <span className="flex-1 text-sm font-sans text-ink">
                  {p.course_a_name} <span className="text-ink-tertiary">↔</span> {p.course_b_name}
                </span>
                <span className="text-xs font-sans text-ink-secondary">{p.overlap_count} тем</span>
                <span
                  className="text-xs font-mono font-medium tabular-nums"
                  style={{ color: simColor(p.max_similarity) }}
                >
                  {Math.round(p.max_similarity * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overlapping topic pairs */}
      {pairs.length === 0 ? (
        <div className="bg-success-bg border border-success/15 rounded-lg p-4 text-sm font-sans text-success">
          Значимого дублирования содержания между выбранными дисциплинами не обнаружено.
        </div>
      ) : (
        <div className="space-y-3">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
            Пересекающиеся темы
          </div>
          {grouped.map((p, i) => <PairCard key={i} pair={p} />)}
        </div>
      )}
    </div>
  )
}

function PairCard({ pair }: { pair: OverlapPair }) {
  const meta = pair.overlap_type ? TYPE_META[pair.overlap_type] : null

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        {meta ? (
          <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-sm ${meta.badge}`}>
            {meta.label}
          </span>
        ) : <span />}
        <span
          className="text-xs font-mono font-medium tabular-nums"
          style={{ color: simColor(pair.similarity) }}
        >
          сходство {Math.round(pair.similarity * 100)}%
        </span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <TopicSide course={pair.course_a_name} topic={pair.topic_a} />
        <TopicSide course={pair.course_b_name} topic={pair.topic_b} />
      </div>

      {(pair.note || pair.recommendation) && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5">
          {pair.note && (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">{pair.note}</p>
          )}
          {pair.recommendation && (
            <p className="text-xs font-sans text-ink leading-relaxed">
              <span className="font-medium text-amber">Рекомендация: </span>
              {pair.recommendation}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function TopicSide({ course, topic }: { course: string; topic: string }) {
  return (
    <div className="bg-surface-warm border border-border rounded-md p-3">
      <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1">
        {course}
      </div>
      <div className="text-sm font-sans text-ink leading-snug">{topic}</div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="font-display text-3xl font-bold text-ink leading-none">{value}</div>
      <div className="text-xs font-sans text-ink-secondary mt-1.5">{label}</div>
    </div>
  )
}
