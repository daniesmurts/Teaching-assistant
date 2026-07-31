import { useState, useEffect, FormEvent } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import CopyAllButton from '../components/ui/CopyAllButton'
import BackLink from '../components/ui/BackLink'
import { Input } from '../components/ui/Input'
import Badge from '../components/ui/Badge'
import { tagColorClasses } from '../lib/tagColor'
import { getCourses } from '../api/courses'
import NoCourseHint from '../components/onboarding/NoCourseHint'
import { generateTasks, getTaskSets, getTaskSet, deleteTaskSet } from '../api/tasks'
import { useUIStore } from '../store/uiStore'
import type { TaskSet, MaterialKind } from '../types'

const DIFFICULTIES = [
  { value: 'basic',        label: 'Базовый' },
  { value: 'intermediate', label: 'Средний' },
  { value: 'advanced',     label: 'Продвинутый' },
]
const DIFFICULTY_LABEL: Record<string, string> = {
  basic: 'Базовый', intermediate: 'Средний', advanced: 'Продвинутый',
}

// Per-kind UI copy. One component serves задания / кейсы / проекты.
const KIND_UI: Record<MaterialKind, {
  title: string; subtitle: string; gen: string; intro: string; placeholder: string
}> = {
  assignment: {
    title: 'Практические задания', subtitle: 'Практические задания по теме', gen: 'Сгенерировать задания',
    intro: 'Укажите тему и уровень сложности — ИСПУМ подготовит набор практических заданий с условиями, развиваемыми умениями и подсказками для преподавателя.',
    placeholder: 'Напр., теплообменное оборудование: расчёт и подбор',
  },
  case: {
    title: 'Кейсы', subtitle: 'Учебные кейсы (case-study) по теме', gen: 'Сгенерировать кейсы',
    intro: 'Укажите тему — ИСПУМ подготовит учебные кейсы: описание ситуации и вопросы для разбора, с указанием развиваемых умений.',
    placeholder: 'Напр., нарушение режима на установке первичной переработки нефти',
  },
  project: {
    title: 'Проекты', subtitle: 'Проектные задания по теме', gen: 'Сгенерировать проекты',
    intro: 'Укажите тему — ИСПУМ подготовит проектные задания: цель, ожидаемый результат и этапы работы, с критериями для преподавателя.',
    placeholder: 'Напр., проектирование кожухотрубчатого теплообменного аппарата',
  },
}

const selectClass = 'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

function resolveKind(raw?: string): MaterialKind {
  return raw === 'case' || raw === 'project' ? raw : 'assignment'
}

export default function MaterialGenerator() {
  const { kind: rawKind } = useParams<{ kind: string }>()
  const kind = resolveKind(rawKind)
  const ui = KIND_UI[kind]

  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  // Deep link from elsewhere (e.g. the ФОС studio's «Источники» panel) — a
  // ?id= opens that generated set directly instead of landing on a blank
  // form. fos_course/fos_doc (also set by that same link) power the "← Назад
  // к ФОС" back-link below.
  const [searchParams] = useSearchParams()
  const linkedId = searchParams.get('id')
  const fosCourse = searchParams.get('fos_course')
  const fosDoc = searchParams.get('fos_doc')

  const [topic, setTopic]           = useState('')
  const [difficulty, setDifficulty] = useState('intermediate')
  const [courseId, setCourseId]     = useState('')
  const [count, setCount]           = useState(5)
  const [result, setResult]         = useState<TaskSet | null>(null)

  // Reset transient state when switching kind via the hub — but not when a
  // ?id= is present, since that's the case that's about to populate `result`.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!linkedId) { setTopic(''); setResult(null) } }, [kind])

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: history = [] } = useQuery({ queryKey: ['task-sets', kind], queryFn: () => getTaskSets(kind) })

  const { data: linkedSet } = useQuery({
    queryKey: ['task-set', linkedId],
    queryFn: () => getTaskSet(linkedId!),
    enabled: Boolean(linkedId),
  })
  useEffect(() => { if (linkedSet) setResult(linkedSet) }, [linkedSet])

  const genMut = useMutation({
    mutationFn: () => generateTasks({ kind, topic: topic.trim(), difficulty, course_id: courseId || undefined, count }),
    onSuccess: (set) => { setResult(set); qc.invalidateQueries({ queryKey: ['task-sets', kind] }) },
  })

  const delMut = useMutation({
    mutationFn: (id: string) => deleteTaskSet(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['task-sets', kind] }),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    if (topic.trim().length < 3) { addToast('Укажите тему', 'error'); return }
    setResult(null)
    genMut.mutate()
  }

  // Copy only the student-facing parts (title + statement). "Развивает" and
  // "Для преподавателя" are teacher-only metadata — including them in the
  // copy ends up pasted into the student handout by accident.
  function copyAll(set: TaskSet) {
    const text = set.tasks
      .map((t, i) => `${i + 1}. ${t.title}\n${t.statement}`)
      .join('\n\n')
    return navigator.clipboard.writeText(text)
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={ui.title}
        subtitle={ui.subtitle}
        actions={fosDoc && <BackLink to={`/fos?course=${fosCourse}&doc=${fosDoc}`} label="← Назад к ФОС" />}
      />

      <div className="flex-1 overflow-y-auto p-4 md:p-6">
        <div className="max-w-[960px] mx-auto page-enter">
          <FeatureIntro id={`material-${kind}`} title="Как это работает" description={ui.intro} />

          <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-4 mb-6 space-y-4">
            <div>
              <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Тема</label>
              <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={ui.placeholder} />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Сложность</label>
                <select className={selectClass} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                  {DIFFICULTIES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Количество</label>
                <select className={selectClass} value={count} onChange={(e) => setCount(Number(e.target.value))}>
                  {[3, 5, 7, 10].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Предмет (опц.)</label>
                <select className={selectClass} value={courseId} onChange={(e) => setCourseId(e.target.value)}>
                  <option value="">Без привязки</option>
                  {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <NoCourseHint />
              </div>
            </div>

            <Button type="submit" loading={genMut.isPending}>{ui.gen}</Button>
          </form>

          {genMut.isPending && (
            <div className="text-center py-12 text-sm font-sans text-ink-secondary">Готовим материалы…</div>
          )}

          {result && !genMut.isPending && (
            <div className="result-appear space-y-3 mb-8">
              <div className="flex items-center justify-between">
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
                  {result.topic} · {DIFFICULTY_LABEL[result.difficulty] ?? result.difficulty}
                </div>
                <CopyAllButton onCopy={() => copyAll(result)} />
              </div>
              {result.tasks.map((t, i) => (
                <div key={i} className="bg-surface border border-border rounded-lg p-4">
                  <div className="text-sm font-sans font-medium text-ink mb-1.5">{i + 1}. {t.title}</div>
                  <p className="text-sm font-sans text-ink leading-relaxed whitespace-pre-wrap">{t.statement}</p>
                  <p className="text-xs font-sans text-ink-secondary mt-2"><span className="font-medium">Развивает:</span> {t.skills}</p>
                  {t.guidance && (
                    <p className="text-xs font-sans text-ink-secondary mt-1"><span className="font-medium text-amber">Для преподавателя:</span> {t.guidance}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div>
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">История</div>
              <div className="bg-surface border border-border rounded-lg divide-y divide-border">
                {history.map((set) => (
                  <div key={set.id} className="flex items-center gap-3 px-4 py-2.5">
                    <button onClick={() => setResult(set)} className="flex-1 text-left min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        {set.course_name && (
                          <Badge className={`flex-shrink-0 max-w-[40%] ${tagColorClasses(set.course_id ?? set.course_name)}`}>
                            {set.course_name}
                          </Badge>
                        )}
                        <div className="text-sm font-sans text-ink truncate min-w-0 flex-1">{set.topic}</div>
                      </div>
                      <div className="text-xs font-sans text-ink-tertiary">
                        {DIFFICULTY_LABEL[set.difficulty] ?? set.difficulty} · {set.tasks.length} шт.
                      </div>
                    </button>
                    <button onClick={() => delMut.mutate(set.id)} title="Удалить"
                            className="text-ink-tertiary hover:text-danger transition-colors text-sm flex-shrink-0">✕</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
