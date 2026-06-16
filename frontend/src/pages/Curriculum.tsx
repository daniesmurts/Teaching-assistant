import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { getCourses } from '../api/courses'
import { analyzeOverlap } from '../api/curriculum'
import { useUIStore } from '../store/uiStore'
import type { CurriculumAnalysis, OverlapPair, OverlapType } from '../types'

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

export default function Curriculum() {
  const addToast = useUIStore((s) => s.addToast)

  const [selected, setSelected] = useState<string[]>([])
  const [result, setResult]     = useState<CurriculumAnalysis | null>(null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const analyzeMut = useMutation({
    mutationFn: () => analyzeOverlap(selected),
    onSuccess: (data) => setResult(data),
    onError: () => { /* toast handled by the axios interceptor */ },
  })

  function toggle(id: string) {
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id])
  }

  function run() {
    if (selected.length < 2) {
      addToast('Выберите минимум две дисциплины', 'error')
      return
    }
    setResult(null)
    analyzeMut.mutate()
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title="Анализ учебного плана"
        subtitle="Дублирование содержания между дисциплинами"
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[960px] mx-auto page-enter">
          <FeatureIntro
            id="curriculum-overlap"
            title="Как это работает"
            description="Выберите дисциплины одного учебного плана — система выделит изучаемые темы каждой дисциплины, сравнит их между собой и покажет, где содержание дублируется для одного студента."
            steps={[
              'Отметьте 2 и более дисциплины (нужна программа или загруженный РПД у каждой)',
              'Система выделяет темы и сравнивает их семантически между дисциплинами',
              'Вы видите пары пересекающихся тем с типом пересечения и рекомендацией',
            ]}
          />

          {/* Discipline picker */}
          <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
            <div className="px-4 py-3 border-b border-border flex items-center justify-between">
              <span className="text-sm font-sans font-medium text-ink">Дисциплины учебного плана</span>
              <span className="text-xs font-sans text-ink-tertiary">
                Выбрано: {selected.length}
              </span>
            </div>

            {courses.length === 0 ? (
              <div className="p-4 text-sm font-sans text-ink-secondary">
                Сначала добавьте дисциплины в разделе «Предметы».
              </div>
            ) : (
              <div className="p-2">
                {courses.map((c) => {
                  const checked = selected.includes(c.id)
                  return (
                    <label
                      key={c.id}
                      className={`flex items-center gap-3 px-3 py-2.5 rounded-md cursor-pointer transition-colors ${
                        checked ? 'bg-amber-light/50' : 'hover:bg-surface-warm'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(c.id)}
                        className="accent-amber w-4 h-4"
                      />
                      <span className="flex-1 text-sm font-sans text-ink">{c.name}</span>
                      {c.code && <span className="text-xs font-sans text-ink-tertiary">{c.code}</span>}
                    </label>
                  )
                })}
              </div>
            )}

            <div className="px-4 py-3 border-t border-border flex items-center gap-3">
              <Button onClick={run} loading={analyzeMut.isPending} disabled={selected.length < 2}>
                Найти дублирование
              </Button>
              <span className="text-xs font-sans text-ink-tertiary">
                Анализ может занять 1–2 минуты
              </span>
            </div>
          </div>

          {analyzeMut.isPending && (
            <div className="text-center py-12 text-sm font-sans text-ink-secondary">
              Выделяем темы и сравниваем дисциплины…
            </div>
          )}

          {result && !analyzeMut.isPending && <Results result={result} />}
        </div>
      </div>
    </div>
  )
}

function Results({ result }: { result: CurriculumAnalysis }) {
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
