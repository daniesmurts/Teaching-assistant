import { useState, FormEvent, KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import Button from '../ui/Button'
import { Input } from '../ui/Input'
import { getCourses } from '../../api/courses'
import NoCourseHint from '../onboarding/NoCourseHint'
import { generatePresentation, type GenerateResponse } from '../../api/presentations'

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
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

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

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!form.topic.trim()) return
    setLoading(true)
    setError('')
    try {
      const res = await generatePresentation({
        topic:            form.topic,
        duration_minutes: Number(form.duration_minutes) || 60,
        learning_goals:   goals,
        course_id:        form.course_id || undefined,
        lecture_number:   form.lecture_number ? Number(form.lecture_number) : undefined,
        audience_level:   form.audience_level || undefined,
        style:            form.style || undefined,
        slide_count_target: form.slide_count_target ? Number(form.slide_count_target) : undefined,
      })
      onResult(res)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
        ?? 'Не удалось создать презентацию'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const selectClass =
    'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md ' +
    'focus:outline-none focus:border-border-strong'

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
          max={30}
          value={form.slide_count_target}
          onChange={set('slide_count_target')}
          placeholder="Авто"
        />
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

      {error && (
        <div className="px-3 py-2 bg-danger-bg text-danger text-xs font-sans rounded-md">{error}</div>
      )}

      <Button type="submit" loading={loading} className="w-full">
        Создать презентацию
      </Button>
    </form>
  )
}
