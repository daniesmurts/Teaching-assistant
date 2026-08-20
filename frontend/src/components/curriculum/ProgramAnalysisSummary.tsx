import type { ProgramAnalysis, OutcomeDelivery, RedundancyItem, PrerequisiteEdge } from '../../types'

// Whole-plan analysis atoms (score colour, stat tile, section label, outcome
// delivery card, gap column, prerequisite edge card) — extracted out of
// InstitutionProgramDetail.tsx's `Report` (TODO Feature AM, Phase 3) so
// Кабинет методиста's «Проверка ОП» tab can render the same score/verdict/
// gaps a РОП sees on the programme page, off the same `ProgramAnalysis`
// shape, without importing the whole 2000+ line programme-detail page.
//
// `ProgramAnalysisSummary` below is deliberately NOT a byte-identical port
// of `Report` — it omits the competency-progression heatmap table and the
// dependency-layer pathway graph (both wide, interactive-editing-adjacent
// visualisations that don't fit a ~700px results column, and belong more to
// the РОП's authoring workspace than a методист's read-only check). What it
// keeps is exactly what a методист is checking for: the headline score and
// verdict, non-fatal warnings, outcome-delivery, sequencing inversions, gaps/
// redundancy, and the load sanity check.

export function scoreColor(s: number): string {
  if (s >= 75) return 'var(--color-success)'
  if (s >= 50) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

export function Stat({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="font-display text-3xl font-bold leading-none" style={{ color: danger ? 'var(--color-danger)' : 'var(--color-ink)' }}>
        {value}
      </div>
      <div className="text-xs font-sans text-ink-secondary mt-1.5">{label}</div>
    </div>
  )
}

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">{children}</div>
}

const DELIVERY_META: Record<OutcomeDelivery['verdict'], { label: string; fg: string; bg: string; border: string }> = {
  delivered: { label: 'Результаты обеспечены',        fg: 'text-success', bg: 'bg-success-bg', border: 'border-success/20' },
  partial:   { label: 'Обеспечены частично',          fg: 'text-warning', bg: 'bg-warning-bg', border: 'border-warning/20' },
  gaps:      { label: 'Есть необеспеченные результаты', fg: 'text-danger',  bg: 'bg-danger-bg',  border: 'border-danger/20' },
}

export function OutcomeDeliveryCard({ d }: { d: OutcomeDelivery }) {
  const meta = DELIVERY_META[d.verdict]
  const chip = (label: string, value: number, color: string) => (
    <span className="inline-flex items-center gap-1.5 text-xs font-sans">
      <span className="w-2 h-2 rounded-full inline-block" style={{ background: color }} />
      <span className="font-medium text-ink">{value}</span>
      <span className="text-ink-secondary">{label}</span>
    </span>
  )
  return (
    <div className={`rounded-lg border p-4 ${meta.bg} ${meta.border}`}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary">
          Достижение результатов программы
        </div>
        <span className={`text-[10px] font-sans font-semibold uppercase tracking-wide ${meta.fg}`}>{meta.label}</span>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-center flex-shrink-0">
          <div className="font-display text-3xl font-bold leading-none" style={{ color: scoreColor(d.score) }}>{d.score}</div>
          <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider mt-0.5">из 100</div>
        </div>
        <p className="text-sm font-sans text-ink leading-relaxed">{d.headline}</p>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 pt-3 border-t border-border">
        {chip('полностью сформированы', d.fully, 'var(--color-success)')}
        {d.thin > 0      && chip('поверхностно', d.thin, 'var(--color-warning)')}
        {d.late > 0      && chip('поздно',       d.late, 'var(--color-warning)')}
        {d.uncovered > 0 && chip('не обеспечены', d.uncovered, 'var(--color-danger)')}
        <span className="text-xs font-sans text-ink-tertiary ml-auto self-center">всего {d.total}</span>
      </div>
    </div>
  )
}

export function GapColumn({ title, items, tone }: {
  title: string; items: RedundancyItem[]; tone: 'warning' | 'danger'
}) {
  const bg = tone === 'danger' ? 'bg-danger-bg border-danger/15' : 'bg-warning-bg border-warning/15'
  const fg = tone === 'danger' ? 'text-danger' : 'text-warning'
  return (
    <div className={`rounded-lg border p-3 ${bg}`}>
      <div className={`text-[10px] font-sans font-semibold uppercase tracking-wide mb-2 ${fg}`}>{title}</div>
      {items.length === 0
        ? <p className="text-xs font-sans text-ink-tertiary">Нет</p>
        : <div className="space-y-2.5">
            {items.map((it, i) => (
              <div key={i}>
                <div className="text-sm font-sans text-ink">{it.name}</div>
                {it.recommendation && <div className="text-xs font-sans text-ink-secondary leading-relaxed mt-0.5">{it.recommendation}</div>}
              </div>
            ))}
          </div>}
    </div>
  )
}

export function EdgeCard({ edge, inverted = false }: { edge: PrerequisiteEdge; inverted?: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${inverted ? 'bg-danger-bg border-danger/15' : 'bg-surface border-border'}`}>
      <div className="flex items-center gap-2 text-sm font-sans mb-1">
        <span className="text-ink">{edge.from_name}</span>
        <span className="text-ink-tertiary text-xs">сем. {edge.from_semester}</span>
        <span className="text-ink-tertiary">→</span>
        <span className="text-ink">{edge.to_name}</span>
        <span className="text-ink-tertiary text-xs">сем. {edge.to_semester}</span>
        {inverted && <span className="ml-auto text-[10px] font-medium text-danger uppercase tracking-wide">нарушение порядка</span>}
      </div>
      {edge.reason && <p className="text-xs font-sans text-ink-secondary leading-relaxed">{edge.reason}</p>}
      {inverted && edge.recommendation && (
        <p className="text-xs font-sans text-ink mt-1.5 leading-relaxed">
          <span className="font-medium text-amber">Рекомендация: </span>{edge.recommendation}
        </p>
      )}
    </div>
  )
}

export default function ProgramAnalysisSummary({ analysis }: { analysis: ProgramAnalysis }) {
  const { sequencing, orphans, missing, clusters, isolated, load, outcome_delivery } = analysis

  return (
    <div className="result-appear space-y-6">
      {/* Headline */}
      <div className="bg-surface border border-border rounded-lg p-5 flex items-center gap-6">
        <div className="text-center flex-shrink-0">
          <div className="font-display text-5xl font-bold leading-none" style={{ color: scoreColor(analysis.overall_score) }}>
            {analysis.overall_score}
          </div>
          <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider mt-1">из 100</div>
        </div>
        <p className="text-sm font-sans text-ink leading-relaxed">{analysis.summary}</p>
      </div>

      {analysis.warnings && analysis.warnings.length > 0 && (
        <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
          <div className="text-[10px] font-sans font-semibold uppercase tracking-wide text-warning mb-1.5">
            Часть анализа не завершилась
          </div>
          <ul className="space-y-1">
            {analysis.warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs font-sans text-ink-secondary leading-relaxed">
                <span className="text-warning flex-shrink-0">⚠</span><span>{w}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {outcome_delivery && <OutcomeDeliveryCard d={outcome_delivery} />}

      <div className="grid grid-cols-2 gap-3">
        <Stat label="Нарушений порядка" value={sequencing.inversions.length} danger={sequencing.inversions.length > 0} />
        <Stat label="Не покрыто компетенций" value={missing.length} danger={missing.length > 0} />
        <Stat label="Дисциплин без вклада" value={orphans.length} danger={orphans.length > 0} />
        <Stat label="Тематических кластеров" value={clusters.length} />
      </div>

      <section>
        <SectionLabel>Последовательность и предпосылки</SectionLabel>
        {sequencing.verdict && (
          <div className="bg-surface border border-border rounded-lg p-4 mb-3">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-xs font-mono font-medium" style={{ color: scoreColor(sequencing.flow_score) }}>
                {sequencing.flow_score}/100
              </span>
              <span className="text-xs font-sans text-ink-tertiary">логичность порядка</span>
            </div>
            <p className="text-sm font-sans text-ink leading-relaxed">{sequencing.verdict}</p>
          </div>
        )}
        {sequencing.inversions.length > 0 && (
          <div className="space-y-2">
            {sequencing.inversions.map((e, i) => <EdgeCard key={i} edge={e} inverted />)}
          </div>
        )}
      </section>

      {(orphans.length > 0 || missing.length > 0) && (
        <section>
          <SectionLabel>Пробелы и избыточность</SectionLabel>
          {analysis.mapping_confidence?.low && missing.length > 0 && (
            <div className="flex items-start gap-1.5 text-xs font-sans text-warning bg-warning-bg border border-warning/15 rounded-md px-3 py-2 mb-3 leading-relaxed">
              <span className="flex-shrink-0 mt-px">⚠</span>
              <span>
                Заявленные компетенции указаны лишь у {analysis.mapping_confidence.disciplines_with_codes} из {analysis.mapping_confidence.disciplines_total} дисциплин.
                Часть пунктов «не покрыто» может быть следствием отсутствия сопоставления, а не реальным пробелом.
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-3">
            <GapColumn title="Нет вклада в компетенции (кандидаты на исключение)" items={orphans} tone="warning" />
            <GapColumn title="Компетенции без дисциплины (нужно добавить)" items={missing} tone="danger" />
          </div>
        </section>
      )}

      <section>
        <SectionLabel>Связность и нагрузка</SectionLabel>
        <div className="bg-surface border border-border rounded-lg p-4 mb-3">
          <div className="text-xs font-sans font-medium text-ink mb-3">Тематические кластеры</div>
          {clusters.length === 0
            ? <p className="text-xs font-sans text-ink-tertiary">Явных кластеров не выявлено.</p>
            : <div className="space-y-2">
                {clusters.map((cl, i) => (
                  <div key={i} className="text-xs font-sans text-ink-secondary leading-relaxed">{cl.disciplines.join(' · ')}</div>
                ))}
              </div>}
          {isolated.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-[10px] font-sans font-semibold text-warning uppercase tracking-wide mb-1">Слабо связаны с планом</div>
              <div className="text-xs font-sans text-ink-secondary">{isolated.join(', ')}</div>
            </div>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg p-4">
          <div className="text-xs font-sans font-medium text-ink mb-3">Нагрузка по семестрам</div>
          <div className="space-y-1.5">
            {load.map((l) => {
              const maxCredits = Math.max(1, ...load.map((x) => x.credits ?? x.discipline_count))
              return (
                <div key={l.semester} className="flex items-center gap-2">
                  <span className="text-[10px] font-sans text-ink-tertiary w-12 flex-shrink-0">Сем. {l.semester}</span>
                  <div className="flex-1 h-3 bg-border rounded-full overflow-hidden">
                    <div className="h-full bg-amber/70 rounded-full"
                      style={{ width: `${((l.credits ?? l.discipline_count) / maxCredits) * 100}%` }} />
                  </div>
                  <span className="text-[10px] font-mono text-ink-secondary w-16 text-right flex-shrink-0">
                    {l.credits != null ? `${l.credits} з.е.` : `${l.discipline_count} дисц.`}
                  </span>
                </div>
              )
            })}
          </div>
          {analysis.load_check && analysis.load_check.issues.length > 0 && (
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-[10px] font-sans font-semibold uppercase tracking-wide text-warning mb-1.5">
                Проверка нагрузки
              </div>
              <ul className="space-y-1">
                {analysis.load_check.issues.map((it, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] font-sans text-ink-secondary leading-relaxed">
                    <span className="text-warning flex-shrink-0">⚠</span><span>{it}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      <p className="text-[10px] font-sans text-ink-tertiary text-center">
        Сформировано {new Date(analysis.generated_at).toLocaleString('ru-RU')}
      </p>
    </div>
  )
}
