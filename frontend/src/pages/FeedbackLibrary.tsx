import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import { Input } from '../components/ui/Input'
import { getCourses } from '../api/courses'
import { searchFeedbackLibrary } from '../api/feedbackLibrary'
import { getAssignment } from '../api/grading'
import AssignmentDetailModal from '../components/grading/AssignmentDetailModal'
import { gradeColor } from '../lib/grades'
import type { Assignment, GradeLetter } from '../types'

/**
 * Searchable library over the teacher's own approved feedback. Vector
 * similarity scoped to (teacher_id, status='approved'). Click any hit to open
 * the full assignment in the same detail modal the History page uses.
 */
export default function FeedbackLibrary() {
  const [query, setQuery]       = useState('')
  const [courseId, setCourseId] = useState('')
  const [submitted, setSubmitted] = useState('')
  const [openId, setOpenId]     = useState<string | null>(null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const { data: hits = [], isLoading, isFetching } = useQuery({
    queryKey: ['library-search', submitted, courseId],
    queryFn:  () => searchFeedbackLibrary({ q: submitted, course_id: courseId || undefined, limit: 15 }),
    enabled:  submitted.trim().length >= 3,
    staleTime: 60_000,
  })

  // Fetch the full assignment for the modal — same query the history page uses.
  const { data: openAssignment } = useQuery({
    queryKey: ['assignment', openId],
    queryFn:  () => getAssignment(openId!),
    enabled:  openId != null,
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setSubmitted(query.trim())
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Библиотека отзывов" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
          <FeatureIntro
            id="feedback-library"
            title="Ваша библиотека отзывов"
            description="Поиск по утверждённым проверкам — найдите похожие работы или вспомните, как вы оценивали аргументацию в прошлый раз. Поиск идёт по смысловой близости (а не по точным словам), поэтому формулируйте запрос так, как вы бы описали тему или вопрос."
            steps={[
              'Введите тему, проблему или фрагмент текста студента.',
              'Опционально сузьте до одного предмета.',
              'Откройте подходящую прошлую работу — со всеми вашими решениями и отзывом.',
            ]}
          />

          {/* Search form */}
          <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-4 mb-5 space-y-3">
            <div className="grid grid-cols-[1fr_180px] gap-2">
              <Input
                placeholder="Например: «выводы не подкреплены данными»"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <select
                className={inputClass + ' py-2'}
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                title="Сузить по предмету"
              >
                <option value="">Все предметы</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <button
              type="submit"
              disabled={query.trim().length < 3}
              className="px-4 py-2 rounded-md bg-amber text-white font-sans text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Искать
            </button>
          </form>

          {/* Results */}
          {!submitted ? (
            <div className="text-center py-10 text-sm font-sans text-ink-tertiary">
              Введите запрос — мы найдём похожие проверки.
            </div>
          ) : isLoading || isFetching ? (
            <div className="text-center py-10 text-sm font-sans text-ink-tertiary">Ищем…</div>
          ) : hits.length === 0 ? (
            <div className="text-center py-10 text-sm font-sans text-ink-secondary">
              Ничего не нашлось. Попробуйте перефразировать запрос или убрать фильтр по предмету.
            </div>
          ) : (
            <div className="space-y-2">
              {hits.map((h) => (
                <button
                  key={h.assignment_id}
                  onClick={() => setOpenId(h.assignment_id)}
                  className="w-full text-left bg-surface border border-border rounded-lg p-4 hover:border-amber/40 hover:bg-surface-warm transition-colors"
                >
                  <div className="flex items-start gap-3">
                    {h.approved_grade && (
                      <div
                        className="font-display text-2xl font-bold leading-none flex-shrink-0 w-10 text-center"
                        style={{ color: gradeColor(h.approved_grade as GradeLetter) }}
                      >
                        {h.approved_grade}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        {h.approved_score != null && (
                          <span className="text-sm font-sans font-medium text-ink">{h.approved_score}/100</span>
                        )}
                        {h.course_name && (
                          <span className="text-[10px] font-sans bg-surface-warm text-ink-secondary border border-border px-1.5 py-0.5 rounded-sm">
                            {h.course_name}
                          </span>
                        )}
                        {h.student_label && (
                          <span className="text-[10px] font-sans text-ink-tertiary">{h.student_label}</span>
                        )}
                        <span className="text-[10px] font-sans text-ink-tertiary">
                          сходство {Math.round((1 - h.similarity) * 100)}%
                        </span>
                      </div>
                      <div className="text-[13px] font-sans text-ink-secondary leading-relaxed">
                        {h.feedback_excerpt || '(отзыв пуст)'}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail modal — reuses the same component the History page uses. */}
      {openAssignment && (
        <AssignmentDetailModal
          assignment={openAssignment as Assignment}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
