import { useState, FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import { Textarea } from '../ui/Input'
import { getCourses } from '../../api/courses'
import { getStudents } from '../../api/grading'
import DocumentUpload from '../ui/DocumentUpload'
import { useUIStore } from '../../store/uiStore'
import { usePlan } from '../../hooks/usePlan'
import client from '../../api/client'
import type { GradeRequest, GradeResponse } from '../../api/grading'
import type { Rubric } from '../../types'

interface Props {
  onResult: (req: GradeRequest, res: GradeResponse) => void
}

export default function GradingForm({ onResult }: Props) {
  const [form, setForm] = useState<GradeRequest>({ submission_text: '', rubric_id: '', course_id: '', student_name: '', student_email: '', student_group: '', reference_solution: '', assignment_type: 'essay' })
  const isCalc = form.assignment_type === 'calculation'
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const { atGradeLimit, gradesUsed, gradesLimit } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: rubrics = [] } = useQuery({
    queryKey: ['rubrics', form.course_id],
    queryFn: () =>
      client.get<Rubric[]>('/api/rubrics', { params: { course_id: form.course_id || undefined } }).then((r) => r.data),
  })

  // Autocomplete suggestions — previously-used names & groups (keeps spelling consistent)
  const { data: students = [] } = useQuery({
    queryKey: ['students', form.course_id],
    queryFn: () => getStudents(form.course_id || undefined),
  })
  const nameSuggestions  = Array.from(new Set(students.map((s) => s.student_name).filter(Boolean)))
  const groupSuggestions = Array.from(new Set(students.map((s) => s.student_group).filter((g): g is string => !!g)))

  const set = (field: keyof GradeRequest) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.submission_text.trim()) return

    setLoading(true)
    setError('')
    try {
      const payload: GradeRequest = {
        submission_text: form.submission_text,
        ...(form.course_id  ? { course_id:  form.course_id  } : {}),
        ...(form.rubric_id  ? { rubric_id:  form.rubric_id  } : {}),
        ...(form.student_name  ? { student_name:  form.student_name  } : {}),
        ...(form.student_group ? { student_group: form.student_group } : {}),
        ...(form.student_email ? { student_email: form.student_email } : {}),
        ...(isCalc ? { assignment_type: 'calculation' as const } : {}),
        ...(form.reference_solution ? { reference_solution: form.reference_solution } : {}),
      }
      const res = await client.post<GradeResponse>('/api/grading/grade', payload)
      onResult(payload, res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Ошибка при проверке'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const selectClass = 'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      {/* Student info */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Информация о студенте
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={selectClass}
            placeholder="Имя студента"
            list="student-name-list"
            value={form.student_name}
            onChange={set('student_name')}
          />
          <input
            className={selectClass}
            placeholder="Группа (напр. БИ-201)"
            list="student-group-list"
            value={form.student_group}
            onChange={set('student_group')}
          />
        </div>
        <input
          className={`${selectClass} mt-2`}
          placeholder="Email (необязательно)"
          value={form.student_email}
          onChange={set('student_email')}
        />
        <datalist id="student-name-list">
          {nameSuggestions.map((n) => <option key={n} value={n} />)}
        </datalist>
        <datalist id="student-group-list">
          {groupSuggestions.map((g) => <option key={g} value={g} />)}
        </datalist>
      </div>

      {/* Course + Rubric */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Курс и критерии оценки
        </div>
        <div className="space-y-2">
          <select className={selectClass} value={form.course_id} onChange={set('course_id')}>
            <option value="">Курс не выбран</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <select className={selectClass} value={form.rubric_id} onChange={set('rubric_id')}>
            <option value="">Без критериев (общая оценка)</option>
            {rubrics.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          {/* Calculation mode → reasoning model + STEM checking */}
          <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
            <input
              type="checkbox"
              checked={isCalc}
              onChange={(e) => setForm((f) => ({ ...f, assignment_type: e.target.checked ? 'calculation' : 'essay' }))}
              className="mt-0.5 h-4 w-4 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
            />
            <span className="text-xs font-sans text-ink-secondary leading-relaxed">
              <span className="text-ink font-medium">Расчётная задача</span> (физика, математика, инженерия) —
              использовать модель с пошаговыми вычислениями
            </span>
          </label>

          {isCalc && (
            <textarea
              className={`${selectClass} resize-none font-mono text-[12.5px]`}
              rows={3}
              placeholder="Эталонное решение / правильный ответ (необязательно) — повышает точность проверки"
              value={form.reference_solution}
              onChange={set('reference_solution')}
            />
          )}
        </div>
      </div>

      {/* Submission */}
      <div className="flex-1 px-4 py-3 flex flex-col">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Работа студента *
        </div>

        {/* Optional document upload — auto-fills the textarea (editable for OCR fixes) */}
        <div className="mb-2">
          <DocumentUpload
            documentType="assignment"
            hint="Загрузите PDF, Word или скан — текст подставится ниже"
            onReady={(doc) => {
              if (doc.extractedText) {
                setForm((f) => ({ ...f, submission_text: doc.extractedText! }))
              }
            }}
          />
        </div>

        <Textarea
          value={form.submission_text}
          onChange={set('submission_text')}
          placeholder="Вставьте текст работы студента или загрузите файл выше…"
          className="flex-1 font-mono text-[13px] leading-relaxed min-h-[160px]"
          required
        />
      </div>

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
          {error}
        </div>
      )}

      <div className="px-4 pb-4 space-y-2">
        {atGradeLimit ? (
          <>
            <div className="px-3 py-2 bg-warning-bg text-warning text-xs font-sans rounded-md">
              Вы использовали все {gradesLimit} бесплатных проверок в этом месяце.
            </div>
            <Button
              type="button"
              className="w-full"
              onClick={() => showUpgradeModal('PLAN_LIMIT_REACHED')}
            >
              Перейти на Pro для продолжения →
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" className="w-full" loading={loading} disabled={atGradeLimit}>
              {loading && isCalc ? 'Пошаговая проверка…' : 'Проверить с ИИ'}
              {!loading && gradesLimit !== null && (
                <span className="ml-2 opacity-60 text-xs">
                  ({gradesUsed}/{gradesLimit})
                </span>
              )}
            </Button>
            {isCalc && (
              <p className="text-[11px] font-sans text-ink-tertiary text-center">
                Расчётные задачи проверяются тщательнее — это может занять до минуты.
              </p>
            )}
          </>
        )}
      </div>
    </form>
  )
}
