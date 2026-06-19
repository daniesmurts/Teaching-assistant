import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { getCourses } from '../api/courses'
import { reviewSyllabus } from '../api/curriculum'
import { useUIStore } from '../store/uiStore'
import type { SyllabusReview, SyllabusCoverageItem, CoverageStatus } from '../types'

// Display metadata per coverage status. Order = most actionable first.
const STATUS_META: Record<CoverageStatus, { label: string; badge: string; order: number }> = {
  missing: { label: 'Не обеспечена', badge: 'bg-danger-bg text-danger',   order: 0 },
  partial: { label: 'Частично',      badge: 'bg-warning-bg text-warning', order: 1 },
  covered: { label: 'Обеспечена',    badge: 'bg-success-bg text-success', order: 2 },
}

function scoreColor(score: number): string {
  if (score >= 85) return 'var(--color-success)'
  if (score >= 50) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

export default function CurriculumConformance() {
  const addToast = useUIStore((s) => s.addToast)

  const [courseId, setCourseId] = useState('')
  const [result, setResult]     = useState<SyllabusReview | null>(null)

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
        description="Выберите дисциплину — система найдёт в её РПД заявленные компетенции (ОПК/ПК/УК) и цели, затем проверит, насколько содержание программы действительно их обеспечивает."
        steps={[
          'Выберите дисциплину (нужна программа или загруженный РПД)',
          'Система извлекает заявленные компетенции и цели из РПД',
          'Для каждой — оценка покрытия, пробелы и рекомендации по доработке',
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
          Извлекаем компетенции и проверяем покрытие…
        </div>
      )}

      {result && !reviewMut.isPending && <Results result={result} />}
    </>
  )
}

function Results({ result }: { result: SyllabusReview }) {
  const { items, summary, covered, partial, missing } = result

  const sorted = [...items].sort(
    (a, b) => STATUS_META[a.status].order - STATUS_META[b.status].order || b.score - a.score
  )

  const sourceNote =
    result.competencies_source === 'declared'
      ? 'Компетенции и цели извлечены из РПД'
      : 'Компетенции и цели заданы вручную'

  return (
    <div className="result-appear space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Обеспечено" value={covered} color="var(--color-success)" />
        <Stat label="Частично" value={partial} color="var(--color-warning)" />
        <Stat label="Не обеспечено" value={missing} color="var(--color-danger)" />
      </div>

      <div className="bg-surface-warm border border-border rounded-lg p-4">
        <p className="text-sm font-sans text-ink leading-relaxed">{summary}</p>
        <p className="text-xs font-sans text-ink-tertiary mt-1.5">{sourceNote}</p>
      </div>

      <div className="space-y-3">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          Компетенции и цели
        </div>
        {sorted.map((item, i) => <CoverageCard key={i} item={item} />)}
      </div>
    </div>
  )
}

function CoverageCard({ item }: { item: SyllabusCoverageItem }) {
  const meta = STATUS_META[item.status]
  const tag = item.kind === 'competency' ? (item.code || 'компетенция') : 'цель'

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider flex-shrink-0">
            {tag}
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

      {item.evidence && (
        <div className="mt-2 text-xs font-sans text-ink-secondary italic border-l-2 border-border pl-2.5 leading-relaxed">
          «{item.evidence}»
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
