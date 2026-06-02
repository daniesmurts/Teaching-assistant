import { useState, FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import { Textarea } from '../ui/Input'
import { getCourses } from '../../api/courses'
import client from '../../api/client'
import type { GradeRequest, GradeResponse } from '../../api/grading'
import type { Rubric } from '../../types'

interface Props {
  onResult: (req: GradeRequest, res: GradeResponse) => void
}

export default function GradingForm({ onResult }: Props) {
  const [form, setForm] = useState<GradeRequest>({ submission_text: '', rubric_id: '', course_id: '', student_name: '', student_email: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: rubrics = [] } = useQuery({
    queryKey: ['rubrics', form.course_id],
    queryFn: () =>
      client.get<Rubric[]>('/api/rubrics', { params: { course_id: form.course_id || undefined } }).then((r) => r.data),
  })

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
        ...(form.student_email ? { student_email: form.student_email } : {}),
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
            value={form.student_name}
            onChange={set('student_name')}
          />
          <input
            className={selectClass}
            placeholder="Email (необязательно)"
            value={form.student_email}
            onChange={set('student_email')}
          />
        </div>
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
        </div>
      </div>

      {/* Submission */}
      <div className="flex-1 px-4 py-3 flex flex-col">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Работа студента *
        </div>
        <Textarea
          value={form.submission_text}
          onChange={set('submission_text')}
          placeholder="Вставьте текст работы студента…"
          className="flex-1 font-mono text-[13px] leading-relaxed min-h-[200px]"
          required
        />
      </div>

      {error && (
        <div className="mx-4 mb-2 px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">
          {error}
        </div>
      )}

      <div className="px-4 pb-4">
        <Button type="submit" className="w-full" loading={loading}>
          Проверить с ИИ
        </Button>
      </div>
    </form>
  )
}
