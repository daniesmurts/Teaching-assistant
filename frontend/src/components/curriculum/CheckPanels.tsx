import type {
  DisciplineCoverageItem, IndicatorDimension,
  ProgramPlacementReview, PlacementSeverity, DeclaredPrerequisiteLink, PlacementFindingKind,
  ProgramMtoReview, MtoDeclaredItem, MtoFindingKind,
} from '../../types'

// Result panels for the РПД-section checks (§2 «место в структуре», §12
// МТО, competency coverage) — extracted out of InstitutionProgramDetail.tsx
// (TODO Feature AM, Phase 1) so Кабинет методиста can render the identical
// panels for a programme discipline without importing the whole 2500+ line
// programme-detail page.

export const COVERAGE_STATUS_META: Record<'covered' | 'partial' | 'missing', { label: string; color: string }> = {
  covered: { label: 'раскрыта',   color: 'var(--color-success)' },
  partial: { label: 'частично',   color: 'var(--color-warning)' },
  missing: { label: 'не раскрыта', color: 'var(--color-danger)' },
}

export const SEVERITY_META: Record<PlacementSeverity, { label: string; badge: string; border: string }> = {
  error:      { label: 'Ошибка',       badge: 'bg-danger-bg text-danger',   border: 'border-l-danger' },
  warning:    { label: 'Предупреждение', badge: 'bg-warning-bg text-warning', border: 'border-l-warning' },
  suggestion: { label: 'Рекомендация', badge: 'bg-amber-light text-amber',  border: 'border-l-amber' },
}
export const PLACEMENT_FINDING_KIND_LABEL: Record<PlacementFindingKind, string> = {
  phantom:        'Дисциплина не найдена в плане',
  inversion:      'Нарушен порядок семестров',
  asymmetry:      'Не подтверждено встречной РПД',
  empty_section:  'Раздел не заполнен',
  wrong_program:  'Другое направление/профиль',
  weak_rationale: 'Слабое обоснование связи',
  missing_link:   'Возможно, пропущена предпосылка',
}
export const MTO_FINDING_KIND_LABEL: Record<MtoFindingKind, string> = {
  generic_only:            'Нет названного ПО',
  generic_software_only:   'Только общее ПО, нет профильного',
  undeclared_tool:         'Инструмент не указан в разделе',
  missing_specialized_tool: 'Возможно, пропущено профильное ПО',
}

// Verdict banner — colour = worst severity present, so a reader skimming
// the panel sees red/amber/green before reading a single word. Shared by
// every РПД-section check panel.
export function VerdictBanner({ severities, summary }: { severities: PlacementSeverity[]; summary: string }) {
  const errors = severities.filter((s) => s === 'error').length
  const clean  = severities.length === 0
  const bannerClass = clean
    ? 'bg-success-bg border-success/30 text-success'
    : errors > 0
      ? 'bg-danger-bg border-danger/30 text-danger'
      : 'bg-warning-bg border-warning/30 text-warning'
  return <div className={`rounded-lg border px-3 py-2.5 font-medium leading-relaxed ${bannerClass}`}>{summary}</div>
}

// One finding card — shared shape across every РПД-section check.
export function FindingCard({
  severity, kindLabel, subjectName, detail, evidence, recommendation,
}: {
  severity:       PlacementSeverity
  kindLabel:      string
  subjectName:    string
  detail:         string
  evidence:       string | null
  recommendation: string
}) {
  const meta = SEVERITY_META[severity]
  return (
    <div className={`bg-surface border border-border border-l-2 ${meta.border} rounded-lg p-3`}>
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-2 flex-wrap min-w-0">
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm flex-shrink-0 ${meta.badge}`}>
            {meta.label}
          </span>
          <span className="text-ink-tertiary">{kindLabel}</span>
        </div>
        {subjectName && <span className="text-ink font-medium flex-shrink-0">{subjectName}</span>}
      </div>
      <div className="text-ink-secondary leading-relaxed">{detail}</div>
      {evidence && <div className="text-ink-tertiary italic mt-1.5">«{evidence}»</div>}
      <div className="text-ink mt-1.5 pt-1.5 border-t border-border">
        <span className="font-medium text-amber">Рекомендация: </span>{recommendation}
      </div>
    </div>
  )
}

// «Место дисциплины в структуре ОП» (migration 100) — declared predecessor/
// successor list + findings (D1-D7, see services/placementReview.ts).
export function PlacementReviewPanel({ review }: { review: ProgramPlacementReview }) {
  const { declared, declared_program, findings, summary } = review.result
  const predecessors = declared.filter((d) => d.role === 'predecessor')
  const successors   = declared.filter((d) => d.role === 'successor')

  return (
    <div className="space-y-3 text-xs font-sans">
      <VerdictBanner severities={findings.map((f) => f.severity)} summary={summary} />

      {declared_program && (
        <div className="text-ink-tertiary">
          Раздел указывает направление/профиль: <span className="text-ink font-medium">«{declared_program}»</span>
        </div>
      )}

      {(predecessors.length > 0 || successors.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <DeclaredList title="Предшествующие" links={predecessors} />
          <DeclaredList title="Последующие" links={successors} />
        </div>
      )}

      {findings.length > 0 && (
        <div className="space-y-2 pt-1">
          {findings.map((f, i) => (
            <FindingCard
              key={i}
              severity={f.severity}
              kindLabel={PLACEMENT_FINDING_KIND_LABEL[f.kind]}
              subjectName={f.discipline_name}
              detail={f.detail}
              evidence={f.evidence}
              recommendation={f.recommendation}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// «Материально-техническое обеспечение» (migration 101) — declared
// software/generic items + findings (see services/mtoReview.ts).
export function MtoReviewPanel({ review }: { review: ProgramMtoReview }) {
  const { software_items, generic_items, findings, summary } = review.result
  // Split by category (migration 101's bucket split) — a list that's all
  // 'general' reads very differently from one with a specialized tool in
  // it, so they get their own columns rather than one flat "Названное ПО".
  const specialized = software_items.filter((s) => s.category === 'specialized')
  const general      = software_items.filter((s) => s.category !== 'specialized')

  return (
    <div className="space-y-3 text-xs font-sans">
      <VerdictBanner severities={findings.map((f) => f.severity)} summary={summary} />

      {(software_items.length > 0 || generic_items.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <QuotedItemList title="Специализированное ПО" items={specialized} dotColor="var(--color-success)" />
          <QuotedItemList title="Общее ПО" items={general} dotColor="var(--color-amber, #b5860b)" />
        </div>
      )}
      {generic_items.length > 0 && (
        <QuotedItemList title="Общие аудиторные средства" items={generic_items} dotColor="var(--color-ink-tertiary, #9ca3af)" />
      )}

      {findings.length > 0 && (
        <div className="space-y-2 pt-1">
          {findings.map((f, i) => (
            <FindingCard
              key={i}
              severity={f.severity}
              kindLabel={MTO_FINDING_KIND_LABEL[f.kind]}
              subjectName={f.item_name}
              detail={f.detail}
              evidence={f.evidence}
              recommendation={f.recommendation}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function QuotedItemList({ title, items, dotColor }: { title: string; items: MtoDeclaredItem[]; dotColor: string }) {
  if (items.length === 0) return null
  return (
    <div>
      <div className="text-[11px] font-sans font-semibold uppercase tracking-wide text-ink-tertiary mb-1">{title}</div>
      <div className="space-y-1.5">
        {items.map((it, i) => (
          <div key={i}>
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0" style={{ background: dotColor }} />
              <span className="text-ink">{it.raw_name}</span>
            </div>
            {it.quote && <div className="text-ink-tertiary italic ml-3 mt-0.5">«{it.quote}»</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function DeclaredList({ title, links }: { title: string; links: DeclaredPrerequisiteLink[] }) {
  if (links.length === 0) return null
  return (
    <div>
      <div className="text-[11px] font-sans font-semibold uppercase tracking-wide text-ink-tertiary mb-1">{title}</div>
      <div className="space-y-1.5">
        {links.map((l, i) => (
          <div key={i}>
            <div className="flex items-center gap-1.5">
              <span
                className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0"
                style={{
                  background: l.resolution === 'internal' ? 'var(--color-success)'
                    : l.resolution === 'external' ? 'var(--color-ink-tertiary, #9ca3af)' : 'var(--color-danger)',
                }}
              />
              <span className="text-ink">{l.raw_name}</span>
              {l.resolution === 'internal' && l.semester != null && (
                <span className="text-ink-tertiary">· сем. {l.semester}</span>
              )}
              {l.resolution === 'external' && <span className="text-ink-tertiary">· внешняя</span>}
              {l.resolution === 'unmatched' && <span className="text-danger">· не найдена в плане</span>}
            </div>
            {/* Verbatim quote from §2 — lets the reader verify the finding
                against the actual document instead of trusting the paraphrase
                (same citation contract as grading/coverage checks). */}
            {l.quote && <div className="text-ink-tertiary italic ml-3 mt-0.5">«{l.quote}»</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

export function countByStatus(items: DisciplineCoverageItem[]): { covered: number; partial: number; missing: number } {
  const counts = { covered: 0, partial: 0, missing: 0 }
  for (const it of items) counts[it.status]++
  return counts
}

const DIMENSION_LABEL: Record<IndicatorDimension, string> = {
  knowledge: 'Знать', skill: 'Уметь', mastery: 'Владеть',
}

// One competency row in a coverage breakdown, with its индикаторы достижения
// nested beneath it (ФГОС 3++). The competency's own status is the roll-up of
// its indicators; each indicator shows its Знать/Уметь/Владеть layer, status,
// evidence quote and note. Legacy reviews (no indicators) render as before.
export function CoverageItemRow({ it }: { it: DisciplineCoverageItem }) {
  const meta = COVERAGE_STATUS_META[it.status]
  return (
    <div className="text-xs font-sans border-l-2 pl-2.5" style={{ borderColor: meta.color }}>
      <div className="flex items-center gap-2">
        <span className="text-ink font-medium">{it.code ? `${it.code} — ${it.title}` : it.title}</span>
        <span style={{ color: meta.color }}>{meta.label}</span>
        {it.indicators && it.indicators.length > 0 && (
          <span className="text-ink-tertiary">· {it.indicators.length} индик.</span>
        )}
      </div>
      {it.evidence && <div className="text-ink-tertiary italic mt-0.5">«{it.evidence}»</div>}
      {it.note && <div className="text-ink-secondary mt-0.5">{it.note}</div>}
      {it.indicators && it.indicators.length > 0 && (
        <div className="mt-1.5 ml-0.5 space-y-1.5 border-l border-border pl-2.5">
          {it.indicators.map((ind, j) => {
            const im = COVERAGE_STATUS_META[ind.status]
            return (
              <div key={j}>
                <div className="flex items-baseline gap-1.5 flex-wrap">
                  <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0 translate-y-[-1px]" style={{ background: im.color }} />
                  {ind.code && <span className="font-mono text-ink-secondary">{ind.code}</span>}
                  {ind.dimension && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-tertiary">{DIMENSION_LABEL[ind.dimension]}</span>
                  )}
                  <span className="text-ink">{ind.title}</span>
                  <span style={{ color: im.color }}>{im.label}</span>
                </div>
                {ind.evidence && <div className="text-ink-tertiary italic ml-3 mt-0.5">«{ind.evidence}»</div>}
                {ind.note && <div className="text-ink-secondary ml-3 mt-0.5">{ind.note}</div>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function CoverageChip({ label, value, status }: { label: string; value: number; status: 'covered' | 'partial' | 'missing' }) {
  const meta = COVERAGE_STATUS_META[status]
  if (value === 0) {
    return <span className="text-ink-tertiary">0 {label}</span>
  }
  return (
    <span className="inline-flex items-center gap-1" style={{ color: meta.color }}>
      <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: meta.color }} />
      <span className="font-medium">{value}</span>
      <span>{label}</span>
    </span>
  )
}
