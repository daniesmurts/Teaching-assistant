import { useState, useRef, useEffect, FormEvent, KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { getCourses } from '../../api/courses'
import NoCourseHint from '../onboarding/NoCourseHint'
import {
  startPresentationJob, getPresentationJob, confirmPresentationOutline,
  extractPresentationSourceText, type GenerateResponse,
} from '../../api/presentations'
import OutlineEditor from './OutlineEditor'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'
import { MAX_SLIDE_COUNT, estimateSlideCount } from '../../types'
import type { PresentationDepth, PresentationOutlineSlide } from '../../types'

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

const AUDIENCE_LEVELS = [
  { value: '',                label: 'Не указан' },
  { value: 'undergraduate_1', label: 'Бакалавриат 1–2 курс' },
  { value: 'undergraduate_2', label: 'Бакалавриат 3–4 курс' },
  { value: 'postgraduate',    label: 'Магистратура / аспирантура' },
  { value: 'professional',    label: 'Дополнительное образование' },
]

const STYLES = [
  { value: '',                label: 'Стиль по умолчанию' },
  { value: 'theory_heavy',    label: 'Теоретический' },
  { value: 'case_study',      label: 'Разбор кейсов' },
  { value: 'discussion_based',label: 'Дискуссионный' },
]

interface Props {
  onResult: (res: GenerateResponse) => void
}

export default function PresentationForm({ onResult }: Props) {
  const [form, setForm] = useState({
    course_id: '', lecture_number: '', topic: '',
    duration_minutes: '60', audience_level: '', style: '',
    slide_count_target: '',
  })
  const [goals, setGoals]     = useState<string[]>([])
  const [goalInput, setGoalInput] = useState('')
  const [sourceText, setSourceText] = useState('')
  const [strictSource, setStrictSource] = useState(false)
  const [depth, setDepth]     = useState<PresentationDepth>('standard')
  const [reviewOutline, setReviewOutline] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  // Outline approval gate (TODO.md "### AO" Phase 0). While `outline` is set
  // the form is replaced by the plan editor; `pendingJobId` is the job that
  // plan belongs to, waiting for a «Написать слайды» that resumes polling.
  const [outline, setOutline] = useState<PresentationOutlineSlide[] | null>(null)
  const [pendingJobId, setPendingJobId] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { can } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)

  // Generation is asynchronous: enqueue + poll (services/presentationJobWorker.ts
  // runs it off the request thread, since Phase 1's outline+expansion can chain
  // several LLM calls well past any HTTP timeout). Guards against delivering a
  // result after the form has unmounted (e.g. teacher navigates away mid-poll).
  const cancelled = useRef(false)
  useEffect(() => () => { cancelled.current = true }, [])

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const set = (field: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  function addGoal() {
    const trimmed = goalInput.trim()
    if (trimmed && !goals.includes(trimmed)) setGoals(g => [...g, trimmed])
    setGoalInput('')
  }

  function handleGoalKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') { e.preventDefault(); addGoal() }
  }

  function errMsg(err: unknown, fallback: string): string {
    return (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? fallback
  }

  // Uploading a .docx recovers formulas as LaTeX (services/ommlToLatex.ts on
  // the backend) — pasting can't, since a Word equation object has no
  // plain-text clipboard form and just vanishes on paste. Replaces
  // sourceText outright rather than appending, since the extracted text is
  // meant to stand in for manual paste, not add to it.
  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-selecting the same file after an error
    if (!file) return
    setUploading(true)
    setUploadError('')
    try {
      const { text, truncated } = await extractPresentationSourceText(file)
      setSourceText(text)
      if (truncated) setUploadError('Текст был обрезан до 20 000 символов — при желании отредактируйте вручную.')
    } catch (err: unknown) {
      setUploadError(errMsg(err, 'Не удалось извлечь текст из файла'))
    } finally {
      setUploading(false)
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.topic.trim()) return
    setLoading(true)
    setError('')
    try {
      cancelled.current = false
      setOutline(null)
      const job = await startPresentationJob({
        topic:            form.topic,
        duration_minutes: Number(form.duration_minutes) || 60,
        learning_goals:   goals,
        course_id:        form.course_id || undefined,
        lecture_number:   form.lecture_number ? Number(form.lecture_number) : undefined,
        audience_level:   form.audience_level || undefined,
        style:            form.style || undefined,
        slide_count_target: form.slide_count_target ? Number(form.slide_count_target) : undefined,
        source_text:      sourceText.trim() || undefined,
        strict_source:    strictSource && Boolean(sourceText.trim()),
        depth,
        review_outline:   reviewOutline,
      })
      await pollJob(job.id)
    } catch (err: unknown) {
      setError(errMsg(err, 'Не удалось создать презентацию'))
      setLoading(false)
    }
  }

  // ~10 minutes of headroom per phase. The first polls run fast because the
  // outline stage lands in seconds (one LLM call) — at a flat 2.5s the
  // approval gate would spend most of its wait on a plan that was already
  // sitting there. Expansion takes minutes, so the cadence relaxes after.
  const FAST_POLLS = 20
  async function pollJob(jobId: string) {
    try {
      for (let i = 0; i < 240 && !cancelled.current; i++) {
        await delay(i < FAST_POLLS ? 1200 : 2500)
        const job = await getPresentationJob(jobId)
        if (job.status === 'ready' && job.result) {
          onResult(job.result)
          return
        }
        // Approval gate — the plan is ready and the job is parked until the
        // teacher confirms it. Leaving the loop here is the point: nothing
        // else runs server-side until confirmOutline() enqueues expansion.
        if (job.status === 'outline_ready' && job.outline) {
          setOutline(job.outline)
          setPendingJobId(job.id)
          return
        }
        if (job.status === 'failed') {
          setError(job.error_message || 'Не удалось создать презентацию')
          return
        }
      }
    } catch (err: unknown) {
      setError(errMsg(err, 'Не удалось создать презентацию'))
    } finally {
      if (!cancelled.current) setLoading(false)
    }
  }

  async function handleConfirmOutline(edited: PresentationOutlineSlide[]) {
    setLoading(true)
    setError('')
    try {
      cancelled.current = false
      await confirmPresentationOutline(pendingJobId, edited)
      setOutline(null)
      await pollJob(pendingJobId)
    } catch (err: unknown) {
      setError(errMsg(err, 'Не удалось подтвердить план'))
      setLoading(false)
    }
  }

  function handleCancelOutline() {
    cancelled.current = true
    setOutline(null)
    setPendingJobId('')
    setLoading(false)
    setError('')
  }

  // Shown in the slide-count placeholder so "Авто" isn't a black box — the
  // teacher can see what the duration implies before deciding to override it.
  // Uses the same shared estimateSlideCount() the generator does, so the
  // number displayed is the number they'll actually get.
  const durationForEstimate = Number(form.duration_minutes)
  const autoSlideCount = Number.isFinite(durationForEstimate) && durationForEstimate >= 10
    ? estimateSlideCount(durationForEstimate)
    : null

  const selectClass =
    'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md ' +
    'focus:outline-none focus:border-border-strong'

  // The plan replaces the form rather than sitting under it: the parameters
  // that produced this outline are already spent, and editing them now would
  // silently not apply to the deck about to be written.
  if (outline) {
    return (
      <OutlineEditor
        outline={outline}
        onConfirm={handleConfirmOutline}
        onCancel={handleCancelOutline}
        confirming={loading}
        error={error || undefined}
      />
    )
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
      <h3 className="font-sans text-sm font-medium text-ink">Новая презентация</h3>

      {/* Row 1 — topic */}
      <Input
        label="Тема лекции *"
        value={form.topic}
        onChange={set('topic')}
        placeholder="Введение в алгоритмы сортировки"
        required
      />

      {/* Row 2 — course + lecture number */}
      <div className="grid grid-cols-[1fr_120px] gap-3">
        <div>
          <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Предмет</label>
          <select className={selectClass} value={form.course_id} onChange={set('course_id')}>
            <option value="">Без предмета</option>
            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <NoCourseHint />
        </div>
        <Input
          label="№ лекции"
          type="number"
          min={1}
          value={form.lecture_number}
          onChange={set('lecture_number')}
          placeholder="1"
        />
      </div>

      {/* Row 3 — duration + slide count */}
      <div className="grid grid-cols-2 gap-3">
        <Input
          label="Длительность (мин) *"
          type="number"
          min={10}
          max={240}
          value={form.duration_minutes}
          onChange={set('duration_minutes')}
          required
        />
        <Input
          label="Кол-во слайдов (авто)"
          type="number"
          min={3}
          max={MAX_SLIDE_COUNT}
          value={form.slide_count_target}
          onChange={set('slide_count_target')}
          placeholder={autoSlideCount ? `Авто — ${autoSlideCount}` : 'Авто'}
        />
      </div>

      {/* Depth — 'deep' is Pro+ (planLimits.ts's presentationDeepMode); a
          free-tier click opens the upgrade modal instead of silently doing
          nothing, same pattern as GradingForm.tsx's thorough-mode gate. */}
      <div>
        <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
          Глубина проработки
        </label>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setDepth('standard')}
            className={`flex-1 px-3 py-2 text-xs font-sans rounded-md border transition-colors ${
              depth === 'standard'
                ? 'border-amber bg-amber-light text-amber font-medium'
                : 'border-border text-ink-secondary hover:border-border-strong'
            }`}
          >
            Стандартная
          </button>
          <button
            type="button"
            onClick={() => can('presentationDeepMode') ? setDepth('deep') : showUpgradeModal('FEATURE_NOT_IN_PLAN')}
            className={`flex-1 px-3 py-2 text-xs font-sans rounded-md border transition-colors ${
              depth === 'deep'
                ? 'border-amber bg-amber-light text-amber font-medium'
                : can('presentationDeepMode')
                  ? 'border-border text-ink-secondary hover:border-border-strong'
                  : 'border-border text-ink-tertiary opacity-60'
            }`}
          >
            Углублённая {!can('presentationDeepMode') && '🔒'}
          </button>
        </div>
        <p className="text-[11px] font-sans text-ink-tertiary mt-1">
          {depth === 'deep'
            ? 'Более длинные заметки докладчика и более подробный разбор каждого слайда.'
            : 'Заметок докладчика хватает примерно на 1.5 минуты речи на слайд.'}
        </p>
      </div>

      {/* Row 4 — audience + style */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Аудитория</label>
          <select className={selectClass} value={form.audience_level} onChange={set('audience_level')}>
            {AUDIENCE_LEVELS.map(l => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Стиль подачи</label>
          <select className={selectClass} value={form.style} onChange={set('style')}>
            {STYLES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
        </div>
      </div>

      {/* Own lecture notes — most teachers already have a conspectus and would
          rather the deck follow it than have the model invent content from
          just the topic. Mirrors Quizzes.tsx's identical field: when present,
          it replaces course RAG retrieval as the source (see
          services/presentations.ts's generatePresentation). */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-sans font-medium text-ink-secondary">
            Свой конспект (опционально)
          </label>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="text-xs font-sans text-amber hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploading ? 'Извлекаем текст…' : 'Загрузить файл (PDF, Word)'}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.doc,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="hidden"
            onChange={handleFileUpload}
          />
        </div>
        <textarea
          className={`${selectClass} min-h-[100px] resize-y`}
          value={sourceText}
          onChange={(e) => setSourceText(e.target.value)}
          placeholder="Вставьте текст своего конспекта — презентация будет построена строго по нему, без привязки к загруженным материалам предмета. Формулы из Word при вставке теряются — для их сохранения загрузите файл .docx кнопкой выше"
          maxLength={20000}
        />
        {uploadError && (
          <p className="text-[11px] font-sans text-danger mt-1">{uploadError}</p>
        )}

        {/* Strict mode only means something when there IS a conspectus, so the
            checkbox stays disabled (and unchecked) until the field has text —
            otherwise it would read as a promise the generator can't keep. */}
        <label
          className={`flex items-start gap-2 mt-2 ${
            sourceText.trim() ? 'cursor-pointer' : 'opacity-60 cursor-not-allowed'
          }`}
        >
          <input
            type="checkbox"
            className="mt-0.5 accent-amber"
            checked={strictSource && Boolean(sourceText.trim())}
            disabled={!sourceText.trim()}
            onChange={(e) => setStrictSource(e.target.checked)}
          />
          <span className="text-[11px] font-sans text-ink-secondary leading-snug">
            Строго по конспекту — ничего не добавлять от себя
            <span className="block text-ink-tertiary">
              Слайды собираются только из вашего текста: без примеров, определений и цифр,
              которых в нём нет. Если материала мало, слайдов будет меньше.
            </span>
          </span>
        </label>
      </div>

      {/* Learning goals */}
      <div>
        <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">
          Цели обучения
        </label>
        <div className="flex gap-2 mb-2">
          <input
            className={`${selectClass} flex-1`}
            placeholder="Студент научится…"
            value={goalInput}
            onChange={e => setGoalInput(e.target.value)}
            onKeyDown={handleGoalKey}
          />
          <Button type="button" size="sm" variant="secondary" onClick={addGoal}>+</Button>
        </div>
        {goals.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {goals.map(g => (
              <span
                key={g}
                className="inline-flex items-center gap-1.5 text-xs font-sans bg-amber-light text-amber px-2 py-1 rounded-md"
              >
                {g}
                <button
                  type="button"
                  onClick={() => setGoals(prev => prev.filter(x => x !== g))}
                  className="opacity-60 hover:opacity-100 leading-none"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Approval gate opt-out. On by default: the plan is where a wrong
          structure costs seconds to fix instead of a full regeneration. */}
      <label className="flex items-start gap-2 cursor-pointer">
        <input
          type="checkbox"
          className="mt-0.5 accent-amber"
          checked={reviewOutline}
          onChange={(e) => setReviewOutline(e.target.checked)}
        />
        <span className="text-[11px] font-sans text-ink-secondary leading-snug">
          Показать план лекции перед генерацией
          <span className="block text-ink-tertiary">
            План появляется за несколько секунд — порядок, тип и состав слайдов можно
            поменять до того, как ИСПУМ напишет текст и заметки.
          </span>
        </span>
      </label>

      {error && (
        <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">{error}</div>
      )}

      <Button type="submit" loading={loading} className="w-full">
        {reviewOutline ? 'Построить план лекции' : 'Создать презентацию'}
      </Button>
    </form>
  )
}
