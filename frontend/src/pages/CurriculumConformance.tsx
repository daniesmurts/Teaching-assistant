import { useQuery, useMutation } from '@tanstack/react-query'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import SyllabusReviewReport from '../components/curriculum/SyllabusReviewReport'
import { getCourses } from '../api/courses'
import { reviewSyllabus } from '../api/curriculum'
import { useUIStore } from '../store/uiStore'
import { useSessionStorageState } from '../hooks/useSessionStorageState'
import type { SyllabusReview } from '../types'

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

      {result && !reviewMut.isPending && <SyllabusReviewReport result={result} />}
    </>
  )
}
