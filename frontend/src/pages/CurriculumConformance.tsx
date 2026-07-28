import { useQuery, useMutation } from '@tanstack/react-query'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import ChallengeButton from '../components/grading/ChallengeButton'
import { getCourses } from '../api/courses'
import { reviewSyllabus } from '../api/curriculum'
import { useUIStore } from '../store/uiStore'
import { useSessionStorageState } from '../hooks/useSessionStorageState'
import type {
  SyllabusReview, SyllabusCoverageItem, CoverageStatus, ContentSection,
  RequirementKind, ParsedSyllabusReport,
} from '../types'

const STATUS_META: Record<CoverageStatus, { label: string; badge: string; order: number }> = {
  missing: { label: 'Не обеспечена', badge: 'bg-danger-bg text-danger',   order: 0 },
  partial: { label: 'Частично',      badge: 'bg-warning-bg text-warning', order: 1 },
  covered: { label: 'Обеспечена',    badge: 'bg-success-bg text-success', order: 2 },
}

// Display label per requirement kind — mirrors the РПД structure КНИТУ uses.
const KIND_META: Record<RequirementKind, { label: string; group: string; order: number }> = {
  goal:        { label: 'цель',       group: 'Цели освоения дисциплины',              order: 0 },
  competency:  { label: 'компетенция', group: 'Компетенции (ОПК/ПК/УК)',              order: 1 },
  indicator:   { label: 'индикатор',  group: 'Индикаторы достижения',                 order: 2 },
  knowledge:   { label: 'знать',      group: 'Должен знать',                          order: 3 },
  skill:       { label: 'уметь',      group: 'Должен уметь',                          order: 4 },
  mastery:     { label: 'владеть',    group: 'Должен владеть',                        order: 5 },
}

// Short section labels used in source chips (§5 / §7 / …).
const SECTION_LABEL: Record<ContentSection, string> = {
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

export default function CurriculumConformance() {
  const addToast = useUIStore((s) => s.addToast)

  const [courseId, setCourseId] = useSessionStorageState('curriculum:conformance:courseId', '')
  const [result, setResult]     = useSessionStorageState<SyllabusReview | null>('curriculum:conformance:result', null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const reviewMut = useMutation({
    mutationFn: () => reviewSyllabus(courseId),
    onSuccess: (data) => setResult(data),
    onError: () => { /* toast handled by the axios interceptor */ },
  })

  function run() {
    if (!courseId) { addToast('Выберите дисциплину', 'error'); return }
    setResult(null)
    reviewMut.mutate()
  }

  return (
    <>
      <FeatureIntro
        id="curriculum-conformance"
        title="Как это работает"
        description="Система разбирает РПД по разделам — цели, компетенции с индикаторами, Знать/Уметь/Владеть — и проверяет, обеспечивает ли реальное содержание (лекции, практические, лабораторные, СРС, контроль) каждое из этих требований."
        steps={[
          'Выберите дисциплину (нужна программа или загруженный РПД)',
          'Система находит требования и разделы содержания РПД',
          'Каждое требование оценивается по содержанию — с цитатой источника и рекомендацией',
        ]}
      />

      {/* Discipline picker */}
      <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-border">
          <span className="text-sm font-sans font-medium text-ink">Дисциплина</span>
        </div>

        {courses.length === 0 ? (
          <div className="p-4 text-sm font-sans text-ink-secondary">
            Сначала добавьте дисциплину в разделе «Предметы».
          </div>
        ) : (
          <div className="p-4">
            <select
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border-mid bg-surface text-sm font-sans text-ink focus:outline-none focus:border-border-strong"
            >
              <option value="">— выберите дисциплину —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <div className="px-4 py-3 border-t border-border flex items-center gap-3">
          <Button onClick={run} loading={reviewMut.isPending} disabled={!courseId}>
            Проверить соответствие
          </Button>
          <span className="text-xs font-sans text-ink-tertiary">Анализ может занять до минуты</span>
        </div>
      </div>

      {reviewMut.isPending && (
        <div className="text-center py-12 text-sm font-sans text-ink-secondary">
          Разбираем РПД на разделы и проверяем покрытие…
        </div>
      )}

      {result && !reviewMut.isPending && <Results result={result} />}
    </>
  )
}

function Results({ result }: { result: SyllabusReview }) {
  const { items, summary, covered, partial, missing, parsed } = result

  // Group by requirement kind in canonical order (Цели → Компетенции → ...).
  const byKind = (['goal','competency','indicator','knowledge','skill','mastery'] as RequirementKind[])
    .map((k) => ({ kind: k, items: items.filter((i) => i.kind === k) }))
    .filter((g) => g.items.length > 0)

  // Within each group, most actionable (missing → partial → covered) first.
  const sortItems = (xs: SyllabusCoverageItem[]) =>
    [...xs].sort((a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || b.score - a.score)

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

      {/* Findings grouped by kind */}
      {byKind.map(({ kind, items }) => (
        <div key={kind} className="space-y-2.5">
          <div className="flex items-center gap-2">
            <h3 className="font-display text-base font-bold text-ink">{KIND_META[kind].group}</h3>
            <span className="text-xs font-sans text-ink-tertiary">({items.length})</span>
          </div>
          {sortItems(items).map((item, i) => <CoverageCard key={i} item={item} />)}
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

function CoverageCard({ item }: { item: SyllabusCoverageItem }) {
  const meta = STATUS_META[item.status]
  const kindMeta = KIND_META[item.kind]
  // Indicators visually nested under their parent competency.
  const indent = item.kind === 'indicator'

  return (
    <div className={`bg-surface border border-border rounded-lg p-4 ${indent ? 'ml-4 border-l-2 border-l-amber/30' : ''}`}>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider flex-shrink-0">
            {item.code || kindMeta.label}
          </span>
          <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-sm ${meta.badge}`}>
            {meta.label}
          </span>
        </div>
        <span
          className="text-xs font-mono font-medium tabular-nums flex-shrink-0"
          style={{ color: scoreColor(item.score) }}
        >
          {item.score}%
        </span>
      </div>

      <div className="text-sm font-sans text-ink leading-snug">{item.title}</div>

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
