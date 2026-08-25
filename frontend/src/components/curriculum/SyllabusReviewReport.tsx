import ChallengeButton from '../grading/ChallengeButton'
import type {
  SyllabusReview, SyllabusCoverageItem, CoverageStatus, ContentSection,
  RequirementKind, ParsedSyllabusReport, OutcomeFormulationFinding, OutcomeKind,
} from '../../types'

// Renders a SyllabusReview — the §5-§8 evidence-citation coverage report
// from POST /api/curriculum/syllabus-review. Extracted from
// CurriculumConformance.tsx (TODO Feature AM, Phase 1) so Кабинет методиста
// can run the same check against a programme discipline and render the
// identical report, instead of importing the whole teacher-facing page.

export const STATUS_META: Record<CoverageStatus, { label: string; badge: string; order: number }> = {
  missing: { label: 'Не обеспечена', badge: 'bg-danger-bg text-danger',   order: 0 },
  partial: { label: 'Частично',      badge: 'bg-warning-bg text-warning', order: 1 },
  covered: { label: 'Обеспечена',    badge: 'bg-success-bg text-success', order: 2 },
}

// Display label per requirement kind — mirrors the РПД structure КНИТУ uses.
export const KIND_META: Record<RequirementKind, { label: string; group: string; order: number }> = {
  goal:        { label: 'цель',       group: 'Цели освоения дисциплины',              order: 0 },
  competency:  { label: 'компетенция', group: 'Компетенции (ОПК/ПК/УК)',              order: 1 },
  indicator:   { label: 'индикатор',  group: 'Индикаторы достижения',                 order: 2 },
  knowledge:   { label: 'знать',      group: 'Должен знать',                          order: 3 },
  skill:       { label: 'уметь',      group: 'Должен уметь',                          order: 4 },
  mastery:     { label: 'владеть',    group: 'Должен владеть',                        order: 5 },
  technology:  { label: 'технология', group: 'Образовательные технологии (§13)',      order: 6 },
}

// Short section labels used in source chips (§5 / §7 / …).
export const SECTION_LABEL: Record<ContentSection, string> = {
  lectures:    '§5 лекции',
  practicals:  '§6 практ.',
  labs:        '§7 лаб.',
  independent: '§8 СРС',
  control:     '§8.1 контроль',
}

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

export default function SyllabusReviewReport({ result }: { result: SyllabusReview }) {
  const { items, summary, covered, partial, missing, parsed } = result
  const formulationFindings = result.formulation_findings ?? []

  // Group by requirement kind in canonical order (Цели → Компетенции → ...).
  const byKind = (['goal','competency','indicator','knowledge','skill','mastery','technology'] as RequirementKind[])
    .map((k) => ({ kind: k, items: items.filter((i) => i.kind === k) }))
    .filter((g) => g.items.length > 0)

  // Within each group, most actionable (missing → partial → covered) first.
  const sortItems = (xs: SyllabusCoverageItem[]) =>
    [...xs].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || b.score - a.score)

  // A formulation finding belongs ON the ЗУВ card it flags. Reported by a
  // методист 2026-08-24: her card read a clean green «Обеспечена 90%» while
  // the only warning sat in a block further up the page, so the score looked
  // unqualified exactly where she was reading. The finding rides the outcome
  // item, never the indicator it was copied from — that indicator's wording is
  // federal text and is not the defect.
  const outcomeKey = (kind: string, title: string) => `${kind}::${title.trim()}`
  const findingByOutcome = new Map(
    formulationFindings.map((f) => [outcomeKey(f.outcome_kind, f.outcome_title), f]),
  )

  // Findings whose ЗУВ line has no card to sit on. buildRequirements caps the
  // scored list at MAX_REQUIREMENTS and appends Знать/Уметь/Владеть *after*
  // competencies and indicators, so on a large РПД the very lines most likely
  // to be copied are the first to fall outside the cap — parsed and flagged,
  // but never individually scored. They keep the standalone block; without it
  // they would disappear entirely once findings render inline.
  const scoredKeys = new Set(items.map((i) => outcomeKey(i.kind, i.title)))
  const orphanFindings = formulationFindings.filter(
    (f) => !scoredKeys.has(outcomeKey(f.outcome_kind, f.outcome_title)),
  )

  const sourceNote =
    result.competencies_source === 'declared'
      ? 'Компетенции и цели извлечены из РПД'
      : 'Компетенции и цели заданы вручную'

  return (
    <div className="result-appear space-y-6">
      {/* Stat strip */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Обеспечено" value={covered} color="var(--color-success)" />
        <Stat label="Частично" value={partial} color="var(--color-warning)" />
        <Stat label="Не обеспечено" value={missing} color="var(--color-danger)" />
      </div>

      {/* Verdict */}
      <div className="bg-surface-warm border border-border rounded-lg p-4">
        <p className="text-sm font-sans text-ink leading-relaxed">{summary}</p>
        <p className="text-xs font-sans text-ink-tertiary mt-1.5">{sourceNote}</p>
      </div>

      {/* What we parsed */}
      {parsed && <ParsedReport parsed={parsed} />}

      {/* Only the findings that have no card of their own (see orphanFindings)
          — every other one renders inline on the item it flags, so the reader
          meets the caveat next to the green score rather than a page away. */}
      {orphanFindings.length > 0 && <FormulationFindings findings={orphanFindings} />}

      {/* Findings grouped by kind */}
      {byKind.map(({ kind, items }) => (
        <div key={kind} className="space-y-2.5">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-ink">{KIND_META[kind].group}</h3>
            <span className="text-xs font-sans text-ink-tertiary">({items.length})</span>
          </div>
          {sortItems(items).map((item, i) => (
            <CoverageCard
              key={i}
              item={item}
              formulation={findingByOutcome.get(outcomeKey(item.kind, item.title)) ?? null}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

const OUTCOME_KIND_LABEL: Record<OutcomeKind, string> = {
  knowledge: 'Знать', skill: 'Уметь', mastery: 'Владеть',
}

// The overflow view: «Знать/Уметь/Владеть» lines that were flagged but fell
// outside the scored requirement cap, so they have no card of their own to
// carry the warning inline (see orphanFindings). Both texts are shown in
// full, one above the other, because the whole point is that the reader can
// see the duplication for themselves rather than trust a similarity number —
// same "show the evidence, don't just assert it" contract the coverage
// citations follow.
function FormulationFindings({ findings }: { findings: OutcomeFormulationFinding[] }) {
  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-2">
        <h3 className="font-display text-base font-bold text-ink">Формулировки результатов обучения</h3>
        <span className="text-xs font-sans text-ink-tertiary">({findings.length})</span>
      </div>
      <p className="text-xs font-sans text-ink-secondary leading-relaxed">
        «Знать/Уметь/Владеть» должны раскрывать смысл индикатора через содержание этой дисциплины.
        Дословное совпадение с индикатором — недоработка, даже если содержание его обеспечивает.
        Эти пункты не вошли в разбор по разделам ниже (в РПД слишком много требований), поэтому показаны отдельно.
      </p>
      {findings.map((f, i) => (
        <div key={i} className="bg-surface border border-border border-l-2 border-l-warning rounded-lg p-4">
          <div className="flex items-center gap-2 flex-wrap mb-2.5">
            <span className="text-[10px] font-sans font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-warning-bg text-warning">
              Повтор индикатора
            </span>
            <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
              {OUTCOME_KIND_LABEL[f.outcome_kind]}
            </span>
            <span className="ml-auto text-xs font-mono font-medium text-warning tabular-nums">
              {Math.round(f.similarity * 100)}%
            </span>
          </div>

          <div className="space-y-1.5">
            <div>
              <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-0.5">
                В разделе «{OUTCOME_KIND_LABEL[f.outcome_kind]}»
              </div>
              <div className="text-sm font-sans text-ink leading-snug">{f.outcome_title}</div>
            </div>
            <div>
              <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-0.5">
                Индикатор{f.indicator_code ? ` ${f.indicator_code}` : ''}
              </div>
              <div className="text-sm font-sans text-ink-secondary leading-snug">{f.indicator_title}</div>
            </div>
          </div>

          <div className="mt-3 pt-3 border-t border-border">
            <p className="text-xs font-sans text-ink leading-relaxed">
              <span className="font-medium text-amber">Рекомендация: </span>{f.recommendation}
            </p>
          </div>
        </div>
      ))}
    </div>
  )
}

function ParsedReport({ parsed }: { parsed: ParsedSyllabusReport }) {
  const counts: { label: string; n: number }[] = [
    { label: 'Цели',       n: parsed.goals_count },
    { label: 'Компетенции',n: parsed.competencies_count },
    { label: 'Индикаторы', n: parsed.indicators_count },
    { label: 'Знать',      n: parsed.knowledge_count },
    { label: 'Уметь',      n: parsed.skills_count },
    { label: 'Владеть',    n: parsed.mastery_count },
    { label: 'Технологии', n: parsed.technologies_count },
  ]
  const present = counts.filter((c) => c.n > 0)
  const missing = counts.filter((c) => c.n === 0).map((c) => c.label)
  const allSections: ContentSection[] = ['lectures', 'practicals', 'labs', 'independent', 'control']

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
        Что нашли в РПД
      </div>
      <div className="flex flex-wrap gap-1.5 mb-3">
        {present.map((c) => (
          <span key={c.label} className="text-xs font-sans bg-amber-light text-amber px-2 py-0.5 rounded-sm">
            {c.label}: {c.n}
          </span>
        ))}
        {missing.map((label) => (
          <span key={label} className="text-xs font-sans bg-surface-warm text-ink-tertiary border border-border px-2 py-0.5 rounded-sm">
            {label}: —
          </span>
        ))}
      </div>
      <div className="text-xs font-sans text-ink-secondary mb-1">Разделы содержания:</div>
      <div className="flex flex-wrap gap-1.5">
        {allSections.map((s) => {
          const found = parsed.content_sections.includes(s)
          return (
            <span
              key={s}
              className={`text-xs font-sans px-2 py-0.5 rounded-sm ${
                found ? 'bg-success-bg text-success' : 'bg-surface-warm text-ink-tertiary border border-border'
              }`}
            >
              {found ? '✓ ' : '— '}{SECTION_LABEL[s]}
            </span>
          )
        })}
      </div>
    </div>
  )
}

function CoverageCard({ item, formulation }: {
  item: SyllabusCoverageItem
  /** Set when this item's own wording merely restates the requirement it
   *  claims to deliver. Deliberately does NOT alter `item.status`: delivery
   *  and wording are independent questions, and folding one into the other
   *  would make covered/partial/missing mean two things at once. It sits
   *  beside the status badge instead, so the green can't be read alone. */
  formulation?: OutcomeFormulationFinding | null
}) {
  const meta = STATUS_META[item.status]
  const kindMeta = KIND_META[item.kind]
  // Indicators visually nested under their parent competency.
  const indent = item.kind === 'indicator'
  const accent = formulation
    ? 'border-l-2 border-l-warning'
    : indent ? 'border-l-2 border-l-amber/30' : ''

  return (
    <div className={`bg-surface border border-border rounded-lg p-4 ${indent ? 'ml-4 ' : ''}${accent}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider flex-shrink-0">
            {item.code || kindMeta.label}
          </span>
          <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-sm ${meta.badge}`}>
            {meta.label}
          </span>
          {formulation && (
            <span
              title="Содержание требование обеспечивает, но сама формулировка скопирована — это отдельная недоработка"
              className="text-[10px] font-sans font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-warning-bg text-warning"
            >
              Повтор формулировки
            </span>
          )}
        </div>
        <span
          className="text-xs font-mono font-medium tabular-nums flex-shrink-0"
          style={{ color: scoreColor(item.score) }}
        >
          {item.score}%
        </span>
      </div>

      <div className="text-sm font-sans text-ink leading-snug">{item.title}</div>

      {/* Both texts stay visible so the duplication is something the reader
          sees for themselves, not a similarity number they have to trust —
          same contract the coverage citations below follow. */}
      {formulation && (
        <div className="mt-2.5 rounded-md bg-warning-bg border border-warning/30 px-3 py-2">
          <p className="text-xs font-sans text-ink leading-relaxed">{formulation.detail}</p>
          <div className="mt-1.5">
            <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-0.5">
              {formulation.indicator_code || 'Источник формулировки'}
            </div>
            <div className="text-xs font-sans text-ink-secondary leading-snug">{formulation.indicator_title}</div>
          </div>
          <p className="text-xs font-sans text-ink leading-relaxed mt-1.5">
            <span className="font-medium text-amber">Рекомендация: </span>{formulation.recommendation}
          </p>
        </div>
      )}

      {/* Source chips — where the evidence lives in the РПД content */}
      {item.sources.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {item.sources.map((s, i) => (
            <div key={i} className="flex items-start gap-2 text-xs font-sans">
              <span className="flex-shrink-0 mt-0.5 px-1.5 py-0.5 rounded-sm bg-amber-light text-amber font-medium">
                {SECTION_LABEL[s.section]}
              </span>
              <span className="text-ink-secondary italic leading-relaxed">«{s.excerpt}»</span>
            </div>
          ))}
        </div>
      )}

      {/* Empty sources but not missing — note it explicitly */}
      {item.sources.length === 0 && item.status !== 'missing' && (
        <div className="mt-2 text-xs font-sans text-ink-tertiary">Источники в содержании РПД не указаны.</div>
      )}

      {item.sources.length > 0 && (
        <div className="mt-2">
          <ChallengeButton
            sourceType="syllabus_coverage"
            claimText={item.gap || item.recommendation || `${meta.label}: ${item.title}`}
            claimQuote={item.evidence}
            sourceText={item.sources.map((s) => `[${SECTION_LABEL[s.section]}] ${s.excerpt}`).join('\n\n')}
            itemRef={item.code || item.title}
          />
        </div>
      )}

      {(item.gap || item.recommendation) && item.status !== 'covered' && (
        <div className="mt-3 pt-3 border-t border-border space-y-1.5">
          {item.gap && (
            <p className="text-xs font-sans text-ink-secondary leading-relaxed">
              <span className="font-medium text-ink">Пробел: </span>{item.gap}
            </p>
          )}
          {item.recommendation && (
            <p className="text-xs font-sans text-ink leading-relaxed">
              <span className="font-medium text-amber">Рекомендация: </span>{item.recommendation}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="font-display text-3xl font-bold leading-none" style={{ color }}>{value}</div>
      <div className="text-xs font-sans text-ink-secondary mt-1.5">{label}</div>
    </div>
  )
}
