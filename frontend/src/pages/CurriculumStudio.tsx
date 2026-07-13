import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { getCourses } from '../api/courses'
import {
  draftSyllabus, reviewSyllabusText, getSavedSyllabusDraft, saveSyllabusDraft, type DraftCompetency,
} from '../api/curriculum'
import { useUIStore } from '../store/uiStore'
import type { SyllabusSection, SyllabusReview } from '../types'

// Debounce for autosaving freehand edits — long enough that normal typing
// doesn't fire a request per keystroke, short enough that a refresh a few
// seconds after the last edit doesn't lose anything.
const AUTOSAVE_DEBOUNCE_MS = 1200

export default function CurriculumStudio() {
  const addToast = useUIStore((s) => s.addToast)

  // Preselect from ?course=<id> — the programme detail page's «Открыть в
  // РПД-студии» bridge deep-links here with the предмет it just found/created.
  const [searchParams] = useSearchParams()
  const [courseId, setCourseId]   = useState(() => searchParams.get('course') ?? '')
  const [sections, setSections]   = useState<SyllabusSection[] | null>(null)
  const [targets, setTargets]     = useState<{ competencies: DraftCompetency[]; goals: string[] }>({ competencies: [], goals: [] })
  const [review, setReview]       = useState<SyllabusReview | null>(null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const disciplineName = courses.find((c) => c.id === courseId)?.name ?? ''

  // Reload a saved draft (initial generation or later edits) whenever the
  // selected course changes — this is what makes the studio survive a
  // refresh instead of always starting blank.
  const savedDraftQuery = useQuery({
    queryKey: ['syllabus-studio-draft', courseId],
    queryFn: () => getSavedSyllabusDraft(courseId),
    enabled: Boolean(courseId),
  })

  useEffect(() => {
    if (!courseId) { setSections(null); setTargets({ competencies: [], goals: [] }); setReview(null); return }
    const saved = savedDraftQuery.data
    if (saved) {
      setSections(saved.sections)
      setTargets({ competencies: saved.competencies, goals: saved.goals })
      setReview(saved.review)
    } else if (savedDraftQuery.isFetched) {
      setSections(null); setTargets({ competencies: [], goals: [] }); setReview(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId, savedDraftQuery.data, savedDraftQuery.isFetched])

  const draftMut = useMutation({
    mutationFn: () => draftSyllabus(courseId),
    onSuccess: (data) => {
      setSections(data.draft.sections)
      setTargets({ competencies: data.competencies, goals: data.goals })
      setReview(data.review)
      // Already persisted server-side (POST /syllabus-draft auto-saves) —
      // no client-side save needed here.
    },
  })

  const recheckMut = useMutation({
    mutationFn: () => reviewSyllabusText(assembled(), targets.competencies, targets.goals),
    onSuccess: (data) => {
      setReview(data)
      addToast('Покрытие пересчитано', 'success')
      if (sections) {
        saveSyllabusDraft({ courseId, disciplineName, sections, competencies: targets.competencies, goals: targets.goals, review: data })
          .catch(() => null)
      }
    },
  })

  function assembled(): string {
    return (sections ?? []).map((s) => `${s.heading}\n${s.content}`).join('\n\n')
  }

  function generate() {
    if (!courseId) { addToast('Выберите дисциплину', 'error'); return }
    setSections(null); setReview(null)
    draftMut.mutate()
  }

  // Autosave freehand edits (debounced) so a refresh mid-edit doesn't lose
  // them — not just the original AI-generated content.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function editSection(i: number, content: string) {
    setSections((prev) => {
      if (!prev) return prev
      const next = prev.map((s, idx) => idx === i ? { ...s, content } : s)
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current)
      autosaveTimer.current = setTimeout(() => {
        saveSyllabusDraft({ courseId, disciplineName, sections: next, competencies: targets.competencies, goals: targets.goals, review })
          .catch(() => null)
      }, AUTOSAVE_DEBOUNCE_MS)
      return next
    })
  }

  // Cancel any pending autosave on unmount — avoids a stale-closure save
  // firing after navigation. Worst case on an untimely navigate-away is
  // losing up to the last ~1.2s of unsaved keystrokes, not the whole edit.
  useEffect(() => () => { if (autosaveTimer.current) clearTimeout(autosaveTimer.current) }, [])

  return (
    <>
      <FeatureIntro
        id="curriculum-studio"
        title="Как это работает"
        description="Выберите дисциплину — ИСПУМ подготовит содержание РПД (цели, результаты по компетенциям, темы, формы контроля), спроектированное под заявленные ОПК/ПК/УК и цели, и сразу проверит покрытие. Вы редактируете и перепроверяете — итоговый автор всегда вы."
        steps={[
          'Выберите дисциплину — её компетенции и цели берутся из РПД',
          'ИСПУМ генерирует содержание под эти компетенции и проверяет покрытие',
          'Отредактируйте разделы и при необходимости перепроверьте покрытие',
        ]}
      />

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
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
        )}
        <div className="px-4 py-3 border-t border-border flex items-center gap-3">
          <Button onClick={generate} loading={draftMut.isPending} disabled={!courseId}>
            Сгенерировать содержание
          </Button>
          <span className="text-xs font-sans text-ink-tertiary">Может занять до минуты</span>
        </div>
      </div>

      {draftMut.isPending && (
        <div className="text-center py-12 text-sm font-sans text-ink-secondary">
          Готовим содержание под компетенции и проверяем покрытие…
        </div>
      )}

      {sections && !draftMut.isPending && (
        <div className="result-appear space-y-4">
          {review && (
            <CoverageBar review={review} />
          )}

          <div className="flex items-center justify-between">
            <div className="text-xs font-sans text-ink-tertiary">
              Под {targets.competencies.length} компетенц. и {targets.goals.length} цел. · черновик можно редактировать
            </div>
            <Button variant="secondary" size="sm" onClick={() => recheckMut.mutate()} loading={recheckMut.isPending}>
              Перепроверить покрытие
            </Button>
          </div>

          {sections.map((s, i) => (
            <div key={i} className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-2.5 border-b border-border bg-surface-warm">
                <span className="text-sm font-sans font-medium text-ink">{s.heading}</span>
              </div>
              <textarea
                value={s.content}
                onChange={(e) => editSection(i, e.target.value)}
                rows={Math.min(16, Math.max(4, s.content.split('\n').length + 1))}
                className="w-full px-4 py-3 text-sm font-sans text-ink leading-relaxed bg-surface resize-y focus:outline-none"
              />
            </div>
          ))}

          <p className="text-xs font-sans text-ink-tertiary">
            ИСПУМ помогает с черновиком — итоговую программу утверждает преподаватель.
          </p>
        </div>
      )}
    </>
  )
}

function CoverageBar({ review }: { review: SyllabusReview }) {
  const total = review.covered + review.partial + review.missing
  const pct = (n: number) => total ? `${(n / total) * 100}%` : '0%'
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-sans font-medium text-ink">Покрытие компетенций и целей</span>
        <span className="text-xs font-sans text-ink-secondary">
          <span className="text-success">{review.covered} обесп.</span> ·{' '}
          <span className="text-warning">{review.partial} частично</span> ·{' '}
          <span className="text-danger">{review.missing} нет</span>
        </span>
      </div>
      <div className="h-1.5 rounded-full overflow-hidden flex bg-border">
        <div className="h-full bg-success" style={{ width: pct(review.covered) }} />
        <div className="h-full bg-warning" style={{ width: pct(review.partial) }} />
        <div className="h-full bg-danger"  style={{ width: pct(review.missing) }} />
      </div>
      <p className="text-xs font-sans text-ink-secondary mt-2 leading-relaxed">{review.summary}</p>
    </div>
  )
}
