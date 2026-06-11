import { useState, useRef, useEffect, useMemo, FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import { Textarea } from '../ui/Input'
import { getCourses } from '../../api/courses'
import { getStudents, startReview, getReview } from '../../api/grading'
import { getCriteria } from '../../api/criteria'
import DocumentUpload from '../ui/DocumentUpload'
import NoCourseHint from '../onboarding/NoCourseHint'
import { useUIStore } from '../../store/uiStore'
import { usePlan } from '../../hooks/usePlan'
import client from '../../api/client'
import type { GradeRequest, GradeResponse } from '../../api/grading'
import { SINGLE_PASS_CHAR_LIMIT } from '../../types'
import type { LongReview, Assignment } from '../../types'

interface Props {
  onResult: (req: GradeRequest, res: GradeResponse) => void
  onReview: (review: LongReview, submission: GradeRequest) => void
  revisionOf?: Assignment | null
  onClearRevision?: () => void
}

interface PickedCriterion {
  id:     string
  name:   string
  weight: number
}

const REVIEW_STATUS_LABEL: Record<string, string> = {
  pending:      'Подготовка…',
  analyzing:    'Анализ разделов',
  synthesizing: 'Составление итоговой рецензии…',
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Distribute 100 across N criteria as evenly as possible, putting the remainder
// on the first item (e.g. 3 picks → [34, 33, 33]).
function evenWeights(n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(100 / n)
  const rem  = 100 - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

export default function GradingForm({ onResult, onReview, revisionOf, onClearRevision }: Props) {
  const [form, setForm] = useState<Omit<GradeRequest, 'criterion_ids' | 'weights'>>(() => ({
    submission_text:     '',
    course_id:           revisionOf?.course_id    ?? '',
    student_name:        revisionOf?.student_name ?? '',
    student_email:       revisionOf?.student_email ?? '',
    student_group:       revisionOf?.student_group ?? '',
    reference_solution:  '',
    assignment_type:     'essay',
    parent_assignment_id: revisionOf?.id,
  }))
  // Picked criteria with weights — managed independently so re-ordering keeps weights in sync.
  const [picked, setPicked] = useState<PickedCriterion[]>(() => {
    const snapshot = revisionOf?.criteria_snapshot
    if (!snapshot || snapshot.length === 0) return []
    return snapshot
      .filter((s): s is typeof s & { criterion_id: string } => s.criterion_id != null)
      .map((s) => ({ id: s.criterion_id, name: s.name, weight: s.weight }))
  })

  const isCalc = form.assignment_type === 'calculation'
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [reviewJob, setReviewJob] = useState<LongReview | null>(null)
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  useEffect(() => {
    if (!revisionOf) {
      setForm((f) => ({ ...f, parent_assignment_id: undefined }))
      return
    }
    setForm((f) => ({
      ...f,
      parent_assignment_id: revisionOf.id,
      course_id:            revisionOf.course_id    ?? f.course_id,
      student_name:         revisionOf.student_name ?? f.student_name,
      student_email:        revisionOf.student_email ?? f.student_email,
      student_group:        revisionOf.student_group ?? f.student_group,
    }))
  }, [revisionOf])

  const { atGradeLimit, gradesUsed, gradesLimit, can } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)

  const charCount = form.submission_text.length
  const isLong = charCount > SINGLE_PASS_CHAR_LIMIT
  const approxPages = Math.round(charCount / 3000)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: criteria = [] } = useQuery({
    queryKey: ['criteria', form.course_id],
    queryFn:  () => getCriteria(form.course_id || undefined),
  })

  const { data: students = [] } = useQuery({
    queryKey: ['students', form.course_id],
    queryFn: () => getStudents(form.course_id || undefined),
  })
  const nameSuggestions  = Array.from(new Set(students.map((s) => s.student_name).filter(Boolean)))
  const groupSuggestions = Array.from(new Set(students.map((s) => s.student_group).filter((g): g is string => !!g)))

  // Criteria available to pick = library minus already-picked
  const pickedIds = useMemo(() => new Set(picked.map((p) => p.id)), [picked])
  const available = criteria.filter((c) => !pickedIds.has(c.id))

  const weightTotal = picked.reduce((s, p) => s + (Number(p.weight) || 0), 0)
  const weightsValid = picked.length === 0 || weightTotal === 100

  function addCriterion(id: string) {
    if (!id) return
    const c = criteria.find((x) => x.id === id)
    if (!c) return
    setPicked((prev) => {
      const next = [...prev, { id: c.id, name: c.name, weight: 0 }]
      const weights = evenWeights(next.length)
      return next.map((item, i) => ({ ...item, weight: weights[i] }))
    })
  }

  function removeCriterion(id: string) {
    setPicked((prev) => {
      const next = prev.filter((p) => p.id !== id)
      if (next.length === 0) return next
      const weights = evenWeights(next.length)
      return next.map((item, i) => ({ ...item, weight: weights[i] }))
    })
  }

  function setWeight(id: string, weight: number) {
    setPicked((prev) => prev.map((p) => p.id === id ? { ...p, weight } : p))
  }

  const set = (field: keyof Omit<GradeRequest, 'criterion_ids' | 'weights'>) => (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm((f) => ({ ...f, [field]: e.target.value }))

  function errMsg(err: unknown, fallback: string): string {
    return (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.submission_text.trim()) return
    if (!weightsValid) {
      setError(`Сумма весов критериев должна быть 100% (сейчас ${weightTotal}%)`)
      return
    }

    if (isLong && !can('documentUpload')) {
      showUpgradeModal('FEATURE_NOT_IN_PLAN')
      return
    }

    setLoading(true)
    setError('')

    const criterionFields = picked.length > 0
      ? { criterion_ids: picked.map((p) => p.id), weights: picked.map((p) => p.weight) }
      : {}

    const common = {
      ...(form.course_id     ? { course_id:     form.course_id  }     : {}),
      ...(form.student_name  ? { student_name:  form.student_name  }  : {}),
      ...(form.student_group ? { student_group: form.student_group } : {}),
      ...(form.student_email ? { student_email: form.student_email } : {}),
      ...(form.parent_assignment_id ? { parent_assignment_id: form.parent_assignment_id } : {}),
      ...criterionFields,
    }

    if (isLong) {
      await runReview(common)
      return
    }

    try {
      const payload: GradeRequest = {
        submission_text: form.submission_text,
        ...common,
        ...(isCalc ? { assignment_type: 'calculation' as const } : {}),
        ...(form.reference_solution ? { reference_solution: form.reference_solution } : {}),
      }
      const res = await client.post<GradeResponse>('/api/grading/grade', payload)
      onResult(payload, res.data)
    } catch (err: unknown) {
      setError(errMsg(err, 'Ошибка при проверке'))
    } finally {
      setLoading(false)
    }
  }

  async function runReview(common: Record<string, unknown>) {
    cancelled.current = false
    try {
      const job = await startReview({ submission_text: form.submission_text, ...common })
      setReviewJob(job)

      for (let i = 0; i < 200 && !cancelled.current; i++) {
        await delay(3000)
        const status = await getReview(job.id)
        setReviewJob(status)
        if (status.status === 'ready') {
          onReview(status, { submission_text: form.submission_text, ...common } as GradeRequest)
          break
        }
        if (status.status === 'failed') {
          setError(status.error_message || 'Не удалось выполнить рецензирование')
          break
        }
      }
    } catch (err: unknown) {
      setError(errMsg(err, 'Не удалось запустить рецензирование'))
    } finally {
      setLoading(false)
      setReviewJob(null)
    }
  }

  const selectClass = 'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'
  const weightInputClass = 'w-14 px-1.5 py-1 text-xs font-mono text-center bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <form onSubmit={handleSubmit} className="flex flex-col h-full">
      {/* Revision banner */}
      {revisionOf && (
        <div className="mx-4 mt-4 px-3 py-2.5 bg-amber-light/60 border border-amber/25 rounded-md flex items-start gap-2.5">
          <span className="text-amber text-sm mt-0.5 flex-shrink-0">↻</span>
          <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed">
            <div className="font-medium text-ink">
              Переработка №{(revisionOf.revision_number ?? 1) + 1}
              {revisionOf.student_name && <span className="font-normal text-ink-secondary"> · {revisionOf.student_name}</span>}
            </div>
            <div className="text-ink-secondary text-[11.5px] mt-0.5">
              ИИ сравнит работу с прошлой версией{(revisionOf.approved_grade ?? revisionOf.ai_grade)
                ? ` (предыдущая оценка: ${revisionOf.approved_grade ?? revisionOf.ai_grade})`
                : ''} и проверит, учтены ли замечания.
            </div>
          </div>
          {onClearRevision && (
            <button
              type="button"
              onClick={onClearRevision}
              title="Отвязать от прошлой версии"
              className="text-ink-tertiary hover:text-ink transition-colors text-sm leading-none flex-shrink-0"
            >
              ×
            </button>
          )}
        </div>
      )}

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

      {/* Course + Criteria */}
      <div className="px-4 py-3 border-b border-border">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Предмет и критерии оценки
        </div>
        <div className="space-y-2.5">
          <div>
            <select className={selectClass} value={form.course_id} onChange={set('course_id')}>
              <option value="">Предмет не выбран</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <NoCourseHint />
          </div>

          {/* Add criterion */}
          <select
            className={selectClass}
            value=""
            onChange={(e) => addCriterion(e.target.value)}
          >
            <option value="">
              {picked.length === 0
                ? 'Без критериев (общая оценка) — или выберите критерий для добавления'
                : '+ Добавить критерий'}
            </option>
            {available.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
                {c.subject ? ` · ${c.subject}` : ''}
              </option>
            ))}
          </select>

          {/* Picked criteria + weights */}
          {picked.length > 0 && (
            <div className="space-y-1.5 pt-1">
              {picked.map((p) => (
                <div key={p.id} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-warm border border-border rounded-md">
                  <span className="flex-1 text-sm font-sans text-ink truncate">{p.name}</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={p.weight}
                    onChange={(e) => setWeight(p.id, Number(e.target.value))}
                    className={weightInputClass}
                  />
                  <span className="text-xs text-ink-tertiary">%</span>
                  <button
                    type="button"
                    onClick={() => removeCriterion(p.id)}
                    className="text-ink-tertiary hover:text-danger text-sm leading-none w-5 text-center"
                    title="Убрать критерий"
                  >
                    ×
                  </button>
                </div>
              ))}
              <div className={`text-[11.5px] font-sans text-right pr-1 ${weightsValid ? 'text-success' : 'text-warning'}`}>
                Сумма весов: {weightTotal}%{!weightsValid && ' — должно быть 100%'}
              </div>
            </div>
          )}

          {/* Calculation mode */}
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

      {/* Large work notice */}
      {isLong && (
        <div className="mx-4 mb-2 px-3 py-2 bg-amber-light/60 border border-amber/20 text-[12px] font-sans text-ink-secondary rounded-md leading-relaxed">
          <span className="font-medium text-ink">Объёмная работа</span> (~{approxPages} стр.). Она будет проверена
          в режиме рецензирования — поразделно, с разбором по главам и вопросами к защите. Это займёт несколько минут.
        </div>
      )}

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
            {reviewJob && (
              <div className="px-3 py-2 bg-surface-warm border border-border rounded-md">
                <div className="flex items-center justify-between text-xs font-sans text-ink-secondary mb-1.5">
                  <span>{REVIEW_STATUS_LABEL[reviewJob.status] ?? 'Рецензирование…'}</span>
                  {reviewJob.progress_total > 0 && (
                    <span className="font-mono text-ink-tertiary">
                      {reviewJob.progress_done}/{reviewJob.progress_total}
                    </span>
                  )}
                </div>
                <div className="h-1 bg-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-amber rounded-full transition-all duration-500 ease-out"
                    style={{
                      width: reviewJob.progress_total > 0
                        ? `${Math.round((reviewJob.progress_done / reviewJob.progress_total) * 100)}%`
                        : '8%',
                    }}
                  />
                </div>
              </div>
            )}

            <Button type="submit" className="w-full" loading={loading} disabled={atGradeLimit || !weightsValid}>
              {loading
                ? (isLong ? 'Рецензируем…' : isCalc ? 'Пошаговая проверка…' : 'Проверяем…')
                : (isLong ? 'Рецензировать работу' : 'Проверить с ИИ')}
              {!loading && gradesLimit !== null && (
                <span className="ml-2 opacity-60 text-xs">
                  ({gradesUsed}/{gradesLimit})
                </span>
              )}
            </Button>
            {isLong ? (
              <p className="text-[11px] font-sans text-ink-tertiary text-center">
                Большие работы рецензируются по разделам — не закрывайте вкладку.
              </p>
            ) : isCalc && (
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
