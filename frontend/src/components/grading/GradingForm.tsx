import { useState, useRef, useEffect, useMemo, FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import { Textarea } from '../ui/Input'
import { getCourses } from '../../api/courses'
import { getStudents, startReview, getReview } from '../../api/grading'
import { getCriteria, getCriteriaTemplates } from '../../api/criteria'
import { getRubrics, getRubricTemplates } from '../../api/rubrics'
import DocumentUpload from '../ui/DocumentUpload'
import NoCourseHint from '../onboarding/NoCourseHint'
import CriteriaHint from '../onboarding/CriteriaHint'
import SimilarPastFeedback from './SimilarPastFeedback'
import DocChatModal from './DocChatModal'
import Icon from '../ui/Icon'
import { useUIStore } from '../../store/uiStore'
import { usePlan } from '../../hooks/usePlan'
import { usePersistedState } from '../../hooks/usePersistedState'
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
export function evenWeights(n: number): number[] {
  if (n <= 0) return []
  const base = Math.floor(100 / n)
  const rem  = 100 - base * n
  return Array.from({ length: n }, (_, i) => base + (i < rem ? 1 : 0))
}

export default function GradingForm({ onResult, onReview, revisionOf, onClearRevision }: Props) {
  // Form fields persist across refresh under "form:draft.fields" — so a teacher
  // doesn't lose half-typed text or uploaded OCR output to an accidental reload.
  // Revision pre-fill is reapplied via the effect below, so an older draft
  // doesn't override an explicit ?revision_of= link.
  const [form, setForm] = usePersistedState<Omit<GradeRequest, 'criterion_ids' | 'weights'>>(
    'form:draft.fields',
    {
      submission_text:     '',
      course_id:           revisionOf?.course_id    ?? '',
      student_name:        revisionOf?.student_name ?? '',
      student_email:       revisionOf?.student_email ?? '',
      student_group:       revisionOf?.student_group ?? '',
      reference_solution:  '',
      assignment_context:  '',
      assignment_type:     'essay',
      parent_assignment_id: revisionOf?.id,
    },
  )
  // Picked criteria with weights — also persisted, separate key so a fresh
  // round can clear just one or the other if we ever need to.
  const [picked, setPicked] = usePersistedState<PickedCriterion[]>(
    'form:draft.criteria',
    (() => {
      const snapshot = revisionOf?.criteria_snapshot
      if (!snapshot || snapshot.length === 0) return []
      return snapshot
        .filter((s): s is typeof s & { criterion_id: string } => s.criterion_id != null)
        .map((s) => ({ id: s.criterion_id, name: s.name, weight: s.weight }))
    })(),
  )

  const isCalc = form.assignment_type === 'calculation'
  // Collapsed by default unless a draft already has context text (e.g. after
  // a page refresh) — keeps the form uncluttered for the common case.
  const [showAssignmentContext, setShowAssignmentContext] = useState(Boolean(form.assignment_context))
  // Thorough mode (confidence ensemble) — opt-in per grade, Pro+ only. Plain
  // state (not persisted): the safe/cheap default is off on every fresh load.
  const [thorough, setThorough] = useState(false)
  // Citation checking — opt-in per grade, Pro+ only, adds latency (web
  // searches). Same "off by default" reasoning as thorough.
  const [checkCitations, setCheckCitations] = useState(false)
  const [docChatOpen, setDocChatOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [reviewJob, setReviewJob] = useState<LongReview | null>(null)
  // True while a review job picked up after a page refresh is still running.
  // Reset to false once the job finishes (or fails) so the banner doesn't
  // linger on a fresh run.
  const [wasResumed, setWasResumed] = useState(false)
  // Persist the in-flight long-review job so a page refresh during the long
  // (multi-minute) processing window doesn't orphan it. We keep the original
  // request alongside the id so the eventual onReview() call can hand the
  // submission text up to Grading.tsx for display.
  const [pendingReview, setPendingReview] = usePersistedState<{ id: string; request: GradeRequest } | null>(
    'review:pending',
    null,
  )
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  // On mount, if there's a pending long review from a previous session, look
  // up its current state and either resume polling, deliver the finished
  // result, or surface the failure. Runs exactly once.
  const resumedRef = useRef(false)
  useEffect(() => {
    if (resumedRef.current || !pendingReview) return
    resumedRef.current = true
    void resumeReview(pendingReview.id, pendingReview.request)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
  const addToast         = useUIStore((s) => s.addToast)

  const charCount = form.submission_text.length
  const isLong = charCount > SINGLE_PASS_CHAR_LIMIT
  const approxPages = Math.round(charCount / 3000)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  // Personal + institution-shared. Globals come from /templates and are merged
  // below so a brand-new teacher with an empty library still sees the curated
  // starter set in the criterion and rubric pickers.
  const { data: personalCriteria = [] } = useQuery({
    queryKey: ['criteria', form.course_id],
    queryFn:  () => getCriteria(form.course_id || undefined),
  })
  const { data: templateCriteria = [] } = useQuery({
    queryKey: ['criteria-templates'],
    queryFn:  getCriteriaTemplates,
  })
  const { data: personalRubrics = [] } = useQuery({
    queryKey: ['rubrics', form.course_id],
    queryFn:  () => getRubrics(form.course_id || undefined),
  })
  const { data: templateRubrics = [] } = useQuery({
    queryKey: ['rubrics-templates'],
    queryFn:  getRubricTemplates,
  })

  // Personal first so dedup keeps the personal copy if a teacher cloned a template.
  const criteria = useMemo(() => {
    const byId = new Map<string, typeof personalCriteria[number]>()
    for (const c of [...personalCriteria, ...templateCriteria]) if (!byId.has(c.id)) byId.set(c.id, c)
    return Array.from(byId.values())
  }, [personalCriteria, templateCriteria])
  const rubrics = useMemo(() => {
    const byId = new Map<string, typeof personalRubrics[number]>()
    for (const r of [...personalRubrics, ...templateRubrics]) if (!byId.has(r.id)) byId.set(r.id, r)
    return Array.from(byId.values())
  }, [personalRubrics, templateRubrics])

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

  /**
   * Apply a saved rubric: replace the picked criteria with the rubric's items,
   * dropping any whose criterion the teacher can't currently see (deleted,
   * shared-then-revoked, etc). Teacher can still edit before submitting.
   */
  function loadFromRubric(rubricId: string) {
    if (!rubricId) return
    const r = rubrics.find((x) => x.id === rubricId)
    if (!r) return
    const next: PickedCriterion[] = []
    for (const it of r.items) {
      const c = criteria.find((x) => x.id === it.criterion_id)
      if (c) next.push({ id: c.id, name: c.name, weight: it.weight })
    }
    if (next.length === 0) {
      addToast('В рубрике не осталось доступных критериев', 'error')
      return
    }
    setPicked(next)
    addToast(`Рубрика «${r.name}» загружена`, 'success')
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
        ...(form.assignment_context ? { assignment_context: form.assignment_context } : {}),
        ...(thorough && can('confidenceCheck') ? { thorough: true } : {}),
        ...(checkCitations && can('citationCheck') ? { check_citations: true } : {}),
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
    const request = { submission_text: form.submission_text, ...common } as GradeRequest
    try {
      const job = await startReview(request)
      setReviewJob(job)
      setPendingReview({ id: job.id, request })
      await pollReview(job.id, request)
    } catch (err: unknown) {
      setError(errMsg(err, 'Не удалось запустить рецензирование'))
      setLoading(false)
      setReviewJob(null)
      setPendingReview(null)
    }
  }

  // Resume polling after a refresh. Looks up the current job state and either
  // delivers the finished result, continues the poll, or surfaces a failure.
  async function resumeReview(jobId: string, request: GradeRequest) {
    cancelled.current = false
    setLoading(true)
    setWasResumed(true)
    try {
      const status = await getReview(jobId)
      setReviewJob(status)
      if (status.status === 'ready') {
        onReview(status, request)
        setPendingReview(null)
        setWasResumed(false)
        return
      }
      if (status.status === 'failed') {
        setError(status.error_message || 'Не удалось выполнить рецензирование')
        setPendingReview(null)
        setWasResumed(false)
        return
      }
      await pollReview(jobId, request)
    } catch (err: unknown) {
      // Treat 404 (job gone) as "nothing to resume" — wipe and let teacher try again.
      const status = (err as { response?: { status?: number } }).response?.status
      if (status === 404) {
        setPendingReview(null)
      } else {
        setError(errMsg(err, 'Не удалось восстановить рецензирование'))
      }
      setWasResumed(false)
    } finally {
      setLoading(false)
      setReviewJob(null)
    }
  }

  // Shared poll loop — used by both fresh starts and post-refresh resumes.
  async function pollReview(jobId: string, request: GradeRequest) {
    try {
      for (let i = 0; i < 200 && !cancelled.current; i++) {
        await delay(3000)
        const status = await getReview(jobId)
        setReviewJob(status)
        if (status.status === 'ready') {
          onReview(status, request)
          setPendingReview(null)
          setWasResumed(false)
          break
        }
        if (status.status === 'failed') {
          setError(status.error_message || 'Не удалось выполнить рецензирование')
          setPendingReview(null)
          setWasResumed(false)
          break
        }
      }
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
        <div className="mx-4 mt-4 pl-3 pr-2.5 py-3 bg-amber-light border-l-4 border-amber border-y border-r border-amber/30 rounded-md shadow-sm flex items-start gap-2.5">
          <span className="flex-shrink-0 mt-0.5 w-6 h-6 rounded-full bg-amber text-surface text-[13px] leading-none flex items-center justify-center">
            ↻
          </span>
          <div className="flex-1 min-w-0 text-[12.5px] leading-relaxed">
            <div className="font-semibold text-ink text-[13px]">
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
              className="flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-ink-tertiary hover:text-ink hover:bg-amber/15 transition-colors text-sm leading-none"
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
            <div className="flex items-center gap-2">
              <select className={`${selectClass} flex-1`} value={form.course_id} onChange={set('course_id')}>
                <option value="">Предмет не выбран</option>
                {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              {form.course_id && can('documentUpload') && (
                <button
                  type="button"
                  onClick={() => setDocChatOpen(true)}
                  title="Спросить документ — вопрос по загруженным материалам предмета"
                  className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-sans font-medium text-amber bg-amber-light/40 border border-amber/25 rounded-full hover:bg-amber-light hover:border-amber/50 transition-colors whitespace-nowrap"
                >
                  <Icon name="message-chat" size={13} />
                  Спросить документ
                </button>
              )}
            </div>
            <NoCourseHint />
          </div>

          {/* Assignment brief / situational context — separate from the rubric:
              tells the model WHAT was asked and under what conditions, so it
              doesn't guess (e.g. mistaking a classroom practicum for an
              industrial one) and judge by the wrong standard. */}
          {showAssignmentContext ? (
            <Textarea
              className="text-[12.5px]"
              rows={3}
              placeholder="Формулировка задания и/или условия его выполнения (напр. «Учебная практика (ознакомительная), проводилась в аудитории, 1 курс»)"
              value={form.assignment_context}
              onChange={set('assignment_context')}
            />
          ) : (
            <button
              type="button"
              onClick={() => setShowAssignmentContext(true)}
              className="text-xs font-sans font-medium text-amber hover:opacity-80 underline decoration-dotted underline-offset-2"
            >
              + Добавить задание и контекст (необязательно) — повышает точность проверки
            </button>
          )}

          {/* Load preset rubric — visible only when teacher has at least one saved rubric.
              Replaces the picked criteria with the rubric's items; weights are still editable. */}
          {rubrics.length > 0 && (
            <select
              className={selectClass}
              value=""
              onChange={(e) => loadFromRubric(e.target.value)}
              title="Загрузить сохранённый набор критериев"
            >
              <option value="">↳ Начать с рубрики...</option>
              {rubrics.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.items.length} крит.
                  {r.is_global_template ? ' · шаблон' : r.is_institution_shared ? ' · кафедра' : ''}
                </option>
              ))}
            </select>
          )}

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
                {c.is_global_template ? ' · шаблон' : ''}
              </option>
            ))}
          </select>
          {picked.length === 0 && <CriteriaHint />}

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

          {/* Thorough mode (confidence ensemble) — Pro+ only */}
          {can('confidenceCheck') ? (
            <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={thorough}
                onChange={(e) => setThorough(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
              />
              <span className="text-xs font-sans text-ink-secondary leading-relaxed">
                <span className="text-ink font-medium">Тщательная проверка</span> — несколько вариантов оценки
                для расчёта уверенности; помечает спорные работы для внимательной проверки. Занимает чуть больше времени.
              </span>
            </label>
          ) : (
            <div className="flex items-start gap-2.5 pt-1 opacity-60">
              <span className="mt-0.5 h-4 w-4 rounded border border-border-mid flex-shrink-0" />
              <span className="text-xs font-sans text-ink-tertiary leading-relaxed">
                <span className="font-medium">Тщательная проверка</span> с расчётом уверенности —
                <span className="text-amber font-medium"> на тарифе Pro</span>
              </span>
            </div>
          )}

          {/* Citation checking — Pro+ only, opt-in (adds latency: web searches) */}
          {can('citationCheck') ? (
            <label className="flex items-start gap-2.5 cursor-pointer select-none pt-1">
              <input
                type="checkbox"
                checked={checkCitations}
                onChange={(e) => setCheckCitations(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border-mid accent-amber cursor-pointer flex-shrink-0"
              />
              <span className="text-xs font-sans text-ink-secondary leading-relaxed">
                <span className="text-ink font-medium">Проверить список литературы</span> — поиск источников
                по списку литературы; результат не доказательство подделки, а повод уточнить у автора.
                Занимает больше времени.
              </span>
            </label>
          ) : (
            <div className="flex items-start gap-2.5 pt-1 opacity-60">
              <span className="mt-0.5 h-4 w-4 rounded border border-border-mid flex-shrink-0" />
              <span className="text-xs font-sans text-ink-tertiary leading-relaxed">
                <span className="font-medium">Проверить список литературы</span> —
                <span className="text-amber font-medium"> на тарифе Pro</span>
              </span>
            </div>
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
            {wasResumed && reviewJob && reviewJob.status !== 'ready' && reviewJob.status !== 'failed' && (
              <div className="px-3 py-2 bg-amber-light/60 border border-amber/25 rounded-md flex items-start gap-2 text-[12px] font-sans text-ink leading-relaxed">
                <span className="text-amber flex-shrink-0">↻</span>
                <span>
                  <span className="font-medium">Рецензирование продолжается.</span>{' '}
                  <span className="text-ink-secondary">
                    Мы восстановили задачу, которую вы запустили до обновления страницы — закрывать вкладку не нужно.
                  </span>
                </span>
              </div>
            )}
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
                ? (isLong ? 'Рецензируем…' : thorough ? 'Тщательная проверка…' : isCalc ? 'Пошаговая проверка…' : 'Проверяем…')
                : (isLong ? 'Рецензировать работу' : 'Проверить')}
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

            {/* While the AI works, surface the teacher's most-similar past
                approved feedback. Gives them something to read instead of the
                spinner, and primes their judgment for the AI's incoming draft. */}
            <SimilarPastFeedback
              submissionText={form.submission_text}
              courseId={form.course_id || undefined}
              active={loading}
            />
          </>
        )}
      </div>

      {docChatOpen && form.course_id && (
        <DocChatModal courseId={form.course_id} onClose={() => setDocChatOpen(false)} />
      )}
    </form>
  )
}
