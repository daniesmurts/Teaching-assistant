import { useState, FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { getCourses } from '../api/courses'
import NoCourseHint from '../components/onboarding/NoCourseHint'
import { getStudents } from '../api/grading'
import { generateTopics, getTopicSets, type GenerateTopicsRequest } from '../api/topics'
import { useUIStore } from '../store/uiStore'
import { usePlan } from '../hooks/usePlan'
import type { TopicSet, TopicItem } from '../types'

const LEVELS = [
  { value: 'bachelor', label: 'Бакалавриат' },
  { value: 'specialist', label: 'Специалитет' },
  { value: 'master', label: 'Магистратура' },
  { value: 'postgraduate', label: 'Аспирантура' },
]
const WORK_TYPES = [
  { value: 'thesis', label: 'ВКР (диплом)' },
  { value: 'coursework', label: 'Курсовая работа' },
  { value: 'internship', label: 'Производственная практика' },
  { value: 'pre_diploma', label: 'Преддипломная практика' },
  { value: 'article', label: 'Научная статья' },
]

const emptyForm: GenerateTopicsRequest = {
  level: 'bachelor', work_type: 'thesis', field: '', interests: '', practice_site: '',
  student_name: '', student_group: '', course_id: '', count: 5,
}

export default function Topics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const { atTopicLimit, topicsUsed, topicsLimit } = usePlan()

  const [form, setForm]     = useState<GenerateTopicsRequest>(emptyForm)
  const [result, setResult] = useState<TopicSet | null>(null)

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: history = [] } = useQuery({ queryKey: ['topic-sets'], queryFn: getTopicSets })
  // Autocomplete from existing students — keeps name/group spelling consistent
  // with the same student in grading, so topics actually link to one person.
  const { data: students = [] } = useQuery({
    queryKey: ['students', form.course_id],
    queryFn: () => getStudents(form.course_id || undefined),
  })
  const nameSuggestions  = Array.from(new Set(students.map((s) => s.student_name).filter(Boolean)))
  const groupSuggestions = Array.from(new Set(students.map((s) => s.student_group).filter((g): g is string => !!g)))

  const genMut = useMutation({
    mutationFn: () => generateTopics({
      level: form.level, work_type: form.work_type,
      field: form.field || undefined, interests: form.interests || undefined,
      practice_site: form.practice_site || undefined, course_id: form.course_id || undefined,
      student_name: form.student_name || undefined, student_group: form.student_group || undefined,
      count: form.count,
    }),
    onSuccess: (set) => { setResult(set); qc.invalidateQueries({ queryKey: ['topic-sets'] }) },
    onError: () => addToast('Не удалось сгенерировать темы', 'error'),
  })

  function submit(e: FormEvent) { e.preventDefault(); genMut.mutate() }
  const set = (k: keyof GenerateTopicsRequest) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  const selectClass = 'w-full px-3 py-2 text-sm font-sans text-ink bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Генератор тем"
        actions={result && (
          <button onClick={() => setResult(null)} className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors">
            ← Новый запрос
          </button>
        )}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[820px] mx-auto px-4 md:px-6 py-6">
          {!result && (
            <FeatureIntro
              id="topics"
              title="Генератор тем — идеи для исследований и практик"
              description="Опишите студента: уровень обучения, направление, интересы и место практики. ИИ предложит конкретные, актуальные и выполнимые темы под нужный уровень — с обоснованием и объёмом работ. Для современности используется поиск в интернете."
              steps={[
                'Выберите уровень обучения и тип работы (ВКР, курсовая, практика…).',
                'Укажите направление, интересы студента и, при наличии, место практики.',
                'Получите список тем с пояснениями — скопируйте подходящие или сгенерируйте ещё.',
              ]}
            />
          )}

          {result ? (
            <TopicResult set={result} />
          ) : atTopicLimit ? (
            <div className="bg-surface border border-border rounded-lg p-6 text-center">
              <p className="font-sans text-sm text-ink-secondary mb-1">
                Вы использовали все {topicsLimit} бесплатных генераций тем в этом месяце.
              </p>
              <Button className="mt-3" onClick={() => showUpgradeModal('PLAN_LIMIT_REACHED')}>Перейти на Pro →</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="bg-surface border border-border rounded-lg p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Уровень обучения">
                  <select className={selectClass} value={form.level} onChange={set('level')}>
                    {LEVELS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </Field>
                <Field label="Тип работы">
                  <select className={selectClass} value={form.work_type} onChange={set('work_type')}>
                    {WORK_TYPES.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                  </select>
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Студент (необязательно)">
                  <input
                    className={selectClass}
                    placeholder="Имя студента"
                    list="topic-student-name-list"
                    value={form.student_name ?? ''}
                    onChange={set('student_name')}
                  />
                </Field>
                <Field label="Группа">
                  <input
                    className={selectClass}
                    placeholder="напр. БИ-201"
                    list="topic-student-group-list"
                    value={form.student_group ?? ''}
                    onChange={set('student_group')}
                  />
                </Field>
              </div>
              <datalist id="topic-student-name-list">
                {nameSuggestions.map((n) => <option key={n} value={n} />)}
              </datalist>
              <datalist id="topic-student-group-list">
                {groupSuggestions.map((g) => <option key={g} value={g} />)}
              </datalist>

              <Field label="Направление / специальность">
                <input className={selectClass} placeholder="напр. Прикладная информатика" value={form.field} onChange={set('field')} />
              </Field>

              <Field label="Научные / практические интересы студента">
                <textarea className={`${selectClass} resize-none`} rows={3} placeholder="напр. машинное обучение, анализ данных, автоматизация бизнес-процессов" value={form.interests} onChange={set('interests')} />
              </Field>

              <Field label="Место практики / исследования (необязательно)">
                <input className={selectClass} placeholder="напр. ПАО «Татнефть», отдел АСУ ТП" value={form.practice_site} onChange={set('practice_site')} />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Предмет (необязательно)">
                  <select className={selectClass} value={form.course_id} onChange={set('course_id')}>
                    <option value="">Без предмета</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <NoCourseHint />
                </Field>
                <Field label="Количество тем">
                  <select className={selectClass} value={form.count} onChange={(e) => setForm((f) => ({ ...f, count: Number(e.target.value) }))}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </Field>
              </div>

              <div className="pt-1">
                <Button type="submit" className="w-full" loading={genMut.isPending}>
                  Предложить темы
                  {topicsLimit !== null && <span className="ml-2 opacity-60 text-xs">({topicsUsed}/{topicsLimit})</span>}
                </Button>
                {genMut.isPending && (
                  <p className="text-[11px] font-sans text-ink-tertiary text-center mt-2">Ищем актуальный контекст и подбираем темы — это займёт до минуты.</p>
                )}
              </div>
            </form>
          )}

          {/* History */}
          {!result && history.length > 0 && (
            <div className="mt-8">
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">Недавние запросы</div>
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                {history.slice(0, 10).map((h, i, arr) => (
                  <button key={h.id} onClick={() => setResult(h)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-sans text-ink truncate">
                        {h.field || 'Без направления'} · {labelFor(WORK_TYPES, h.work_type)}
                        {h.student_name && (
                          <span className="text-ink-secondary font-normal"> · для {h.student_name}</span>
                        )}
                      </div>
                      <div className="text-xs font-sans text-ink-tertiary">
                        {labelFor(LEVELS, h.level)} · {h.topics.length} тем
                        {h.student_group && <span> · {h.student_group}</span>}
                        <span> · {new Date(h.created_at).toLocaleDateString('ru-RU')}</span>
                      </div>
                    </div>
                    <span className="text-ink-tertiary text-xs flex-shrink-0">→</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function labelFor(list: { value: string; label: string }[], v: string): string {
  return list.find((x) => x.value === v)?.label ?? v
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">{label}</label>
      {children}
    </div>
  )
}

function TopicResult({ set }: { set: TopicSet }) {
  const addToast = useUIStore((s) => s.addToast)
  function copyAll() {
    const text = set.topics.map((t, i) => `${i + 1}. ${t.title}\n${t.rationale}\n${t.scope}`).join('\n\n')
    navigator.clipboard.writeText(text).then(() => addToast('Скопировано', 'success'))
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-sans text-ink-secondary">
          {set.topics.length} тем
          {set.used_search && <span className="ml-2 text-[10px] font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">✦ с поиском</span>}
        </div>
        <button onClick={copyAll} className="text-xs font-sans text-amber hover:underline">Скопировать все</button>
      </div>
      {set.topics.map((t, i) => <TopicCard key={i} topic={t} index={i} />)}
    </div>
  )
}

function TopicCard({ topic, index }: { topic: TopicItem; index: number }) {
  const addToast = useUIStore((s) => s.addToast)
  function copy() {
    navigator.clipboard.writeText(`${topic.title}\n\n${topic.rationale}\n\n${topic.scope}`).then(() => addToast('Тема скопирована', 'success'))
  }
  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="flex items-start gap-3">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber/15 text-amber text-xs font-semibold flex items-center justify-center mt-0.5">{index + 1}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-display text-base font-bold text-ink leading-snug">{topic.title}</h3>
          {topic.rationale && <p className="text-[13px] font-sans text-ink-secondary leading-relaxed mt-2">{topic.rationale}</p>}
          {topic.scope && (
            <div className="mt-2.5">
              <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1">Что предстоит сделать</div>
              <p className="text-[13px] font-sans text-ink-secondary leading-relaxed">{topic.scope}</p>
            </div>
          )}
          {topic.site_link && (
            <div className="mt-2.5">
              <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wide mb-1">Связь с местом практики</div>
              <p className="text-[13px] font-sans text-ink-secondary leading-relaxed">{topic.site_link}</p>
            </div>
          )}
          {topic.outcome && (
            <div className="mt-2.5 bg-surface-warm border border-border rounded-md px-3 py-2">
              <div className="text-[10px] font-sans font-semibold text-success uppercase tracking-wide mb-1">Результат / новизна</div>
              <p className="text-[13px] font-sans text-ink-secondary leading-relaxed">{topic.outcome}</p>
            </div>
          )}
        </div>
        <button onClick={copy} title="Скопировать" className="flex-shrink-0 text-ink-tertiary hover:text-amber text-sm">⧉</button>
      </div>
    </div>
  )
}
