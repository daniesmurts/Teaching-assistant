import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { getCourses } from '../api/courses'
import { getCriteria, getCriteriaTemplates } from '../api/criteria'
import {
  getRubrics, getRubricTemplates, createRubric, updateRubric, deleteRubric,
  type RubricPayload,
} from '../api/rubrics'
import { evenWeights } from '../components/grading/GradingForm'
import { useUIStore } from '../store/uiStore'
import type { Rubric, RubricItem, Criterion, CriterionSubject } from '../types'

const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

const SUBJECTS: CriterionSubject[] = [
  'general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities',
]

interface PickedItem extends RubricItem { name: string }

interface FormState {
  id?:         string
  name:        string
  description: string
  course_id:   string
  subject:     CriterionSubject | ''
  picked:      PickedItem[]
}
const emptyForm: FormState = { name: '', description: '', course_id: '', subject: '', picked: [] }

export default function Rubrics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data: rubrics = [] }            = useQuery({ queryKey: ['rubrics-all'],         queryFn: () => getRubrics() })
  const { data: templates = [] }          = useQuery({ queryKey: ['rubrics-templates'],   queryFn: getRubricTemplates })
  const { data: courses = [] }            = useQuery({ queryKey: ['courses'],             queryFn: getCourses })
  const { data: personalCriteria = [] }   = useQuery({ queryKey: ['criteria-all'],        queryFn: () => getCriteria() })
  const { data: templateCriteria = [] }   = useQuery({ queryKey: ['criteria-templates'],  queryFn: getCriteriaTemplates })

  // Merge personal + globals so a new teacher's picker is not empty and so
  // global-rubric "use as template" can resolve criterion ids in pickedFromRubric.
  const criteria = useMemo(() => {
    const byId = new Map<string, Criterion>()
    for (const c of [...personalCriteria, ...templateCriteria]) if (!byId.has(c.id)) byId.set(c.id, c)
    return Array.from(byId.values())
  }, [personalCriteria, templateCriteria])

  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name
  const criterionById = useMemo(() => new Map(criteria.map((c) => [c.id, c])), [criteria])

  const weightTotal = form.picked.reduce((s, p) => s + p.weight, 0)
  const weightsValid = form.picked.length > 0 && weightTotal === 100
  const pickedIds = new Set(form.picked.map((p) => p.criterion_id))
  const available = criteria.filter((c) => !pickedIds.has(c.id))

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const payload: RubricPayload = {
        name:        f.name,
        description: f.description || null,
        course_id:   f.course_id || undefined,
        subject:     f.subject || undefined,
        items:       f.picked.map((p) => ({ criterion_id: p.criterion_id, weight: p.weight })),
      }
      return f.id ? updateRubric(f.id, payload) : createRubric(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rubrics-all'] })
      qc.invalidateQueries({ queryKey: ['rubrics'] })
      addToast('Рубрика сохранена', 'success')
      close()
    },
    onError: () => addToast('Не удалось сохранить рубрику', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteRubric,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rubrics-all'] })
      qc.invalidateQueries({ queryKey: ['rubrics'] })
    },
    onError: () => addToast('Не удалось удалить рубрику', 'error'),
  })

  function close() { setShowForm(false); setForm(emptyForm) }
  function openNew() { setForm(emptyForm); setShowForm(true) }

  function pickedFromRubric(r: Rubric): PickedItem[] {
    // Drop items whose criterion the current teacher can't see (e.g. deleted
    // or shared by an admin they no longer have access to).
    return r.items
      .map((it) => {
        const c = criterionById.get(it.criterion_id)
        return c ? { criterion_id: it.criterion_id, weight: it.weight, name: c.name } : null
      })
      .filter((x): x is PickedItem => x !== null)
  }

  function openEdit(r: Rubric) {
    setForm({
      id:          r.id,
      name:        r.name,
      description: r.description ?? '',
      course_id:   r.course_id ?? '',
      subject:     r.subject ?? '',
      picked:      pickedFromRubric(r),
    })
    setShowForm(true)
  }
  function fromTemplate(t: Rubric) {
    setForm({
      name:        t.name,
      description: t.description ?? '',
      course_id:   '',
      subject:     t.subject ?? '',
      picked:      pickedFromRubric(t),
    })
    setShowForm(true)
  }

  function addCriterion(id: string) {
    if (!id) return
    const c = criterionById.get(id)
    if (!c) return
    setForm((f) => {
      const next: PickedItem[] = [...f.picked, { criterion_id: id, weight: 0, name: c.name }]
      const w = evenWeights(next.length)
      return { ...f, picked: next.map((p, i) => ({ ...p, weight: w[i] })) }
    })
  }
  function removeCriterion(id: string) {
    setForm((f) => {
      const next = f.picked.filter((p) => p.criterion_id !== id)
      const w = evenWeights(next.length)
      return { ...f, picked: next.map((p, i) => ({ ...p, weight: w[i] })) }
    })
  }
  function setWeight(id: string, weight: number) {
    setForm((f) => ({
      ...f,
      picked: f.picked.map((p) => p.criterion_id === id ? { ...p, weight } : p),
    }))
  }

  function submit() {
    if (!form.name.trim()) { addToast('Введите название рубрики', 'error'); return }
    if (form.picked.length === 0) { addToast('Добавьте хотя бы один критерий', 'error'); return }
    if (!weightsValid) { addToast(`Сумма весов должна быть 100% (сейчас ${weightTotal}%)`, 'error'); return }
    saveMut.mutate(form)
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'
  const weightInputClass = 'w-14 px-1.5 py-1 text-xs font-sans text-ink bg-surface border border-border rounded-md text-center'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Рубрики"
        actions={!showForm && <Button size="sm" onClick={openNew}>+ Новая рубрика</Button>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">

          {!showForm && (
            <FeatureIntro
              id="rubrics"
              title="Рубрики — сохранённые наборы критериев с весами"
              description="Если вы часто проверяете работы по одним и тем же критериям с одинаковыми весами — соберите их в рубрику. На странице проверки можно будет одним кликом подставить готовый набор и при необходимости поправить веса перед запуском."
              steps={[
                'Создайте рубрику с нуля или начните с готового шаблона по вашей дисциплине.',
                'Добавьте критерии из своей библиотеки и распределите между ними 100% веса.',
                'При проверке работы выберите рубрику — критерии и веса подставятся автоматически.',
                'Любой пункт можно поменять перед отправкой работы на проверку.',
              ]}
            />
          )}

          {showForm ? (
            <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
              <h2 className="font-display text-lg font-bold text-ink">
                {form.id ? 'Редактировать рубрику' : 'Новая рубрика'}
              </h2>

              <Input label="Название" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Напр. Эссе по экономике" />

              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Описание</label>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={2}
                  placeholder="Короткое описание для себя — где применять эту рубрику"
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Предмет</label>
                  <select className={inputClass + ' py-2'} value={form.course_id}
                    onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value }))}>
                    <option value="">Все предметы</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Область</label>
                  <select className={inputClass + ' py-2'} value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value as CriterionSubject | '' }))}>
                    <option value="">—</option>
                    {SUBJECTS.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>

              {/* Criteria picker */}
              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Критерии и веса</label>
                <select className={inputClass + ' py-2'} value="" onChange={(e) => addCriterion(e.target.value)}>
                  <option value="">
                    {form.picked.length === 0 ? 'Выберите критерий…' : '+ Добавить критерий'}
                  </option>
                  {available.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.subject ? ` · ${SUBJECT_LABEL[c.subject] ?? c.subject}` : ''}
                      {c.is_global_template ? ' · шаблон' : ''}
                    </option>
                  ))}
                </select>

                {form.picked.length > 0 && (
                  <div className="space-y-1.5 pt-2">
                    {form.picked.map((p) => (
                      <div key={p.criterion_id} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-warm border border-border rounded-md">
                        <span className="flex-1 text-sm font-sans text-ink truncate">{p.name}</span>
                        <input
                          type="number" min={0} max={100} value={p.weight}
                          onChange={(e) => setWeight(p.criterion_id, Number(e.target.value))}
                          className={weightInputClass}
                        />
                        <span className="text-xs text-ink-tertiary">%</span>
                        <button type="button" onClick={() => removeCriterion(p.criterion_id)}
                          className="text-ink-tertiary hover:text-danger text-sm leading-none w-5 text-center"
                          title="Убрать критерий">×</button>
                      </div>
                    ))}
                    <div className={`text-[11.5px] font-sans text-right pr-1 ${weightsValid ? 'text-success' : 'text-warning'}`}>
                      Сумма весов: {weightTotal}%{!weightsValid && ' — должно быть 100%'}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" loading={saveMut.isPending} onClick={submit}>Сохранить</Button>
                <Button size="sm" variant="secondary" onClick={close}>Отмена</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Templates */}
              {templates.length > 0 && (
                <div className="mb-6">
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    Начать с готового шаблона
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => fromTemplate(t)}
                        className="px-3 py-1.5 text-xs font-sans bg-surface border border-border rounded-md hover:border-amber/40 hover:bg-amber-light transition-colors">
                        {t.name}
                        {t.subject && <span className="text-ink-tertiary ml-1.5">· {SUBJECT_LABEL[t.subject] ?? t.subject}</span>}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Existing rubrics */}
              {rubrics.length === 0 ? (
                <div className="text-center py-12">
                  <p className="font-sans text-sm text-ink-secondary mb-1">У вас пока нет рубрик.</p>
                  <p className="font-sans text-xs text-ink-tertiary">
                    Соберите набор критериев с весами один раз — и подставляйте его на странице проверки одним кликом.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rubrics.map((r) => (
                    <div key={r.id} className="bg-surface border border-border rounded-lg p-4 flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-sans text-sm font-medium text-ink">{r.name}</span>
                          {r.subject && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">{SUBJECT_LABEL[r.subject] ?? r.subject}</span>}
                          {r.course_id && <span className="text-[10px] bg-surface-warm text-ink-secondary border border-border px-1.5 py-0.5 rounded-sm">{courseName(r.course_id) ?? 'предмет'}</span>}
                          {r.is_institution_shared && <span className="text-[10px] bg-info-bg text-info px-1.5 py-0.5 rounded-sm">кафедра</span>}
                          <span className="text-[10px] text-ink-tertiary">{r.items.length} {pluralCriteria(r.items.length)}</span>
                        </div>
                        {r.description && (
                          <div className="text-xs font-sans text-ink-tertiary mt-1 leading-relaxed">{r.description}</div>
                        )}
                        <div className="text-[11px] font-sans text-ink-tertiary mt-2 truncate">
                          {r.items
                            .map((it) => {
                              const c = criterionById.get(it.criterion_id)
                              return c ? `${c.name} · ${it.weight}%` : null
                            })
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      </div>
                      <div className="flex gap-2 flex-shrink-0 ml-3">
                        <button onClick={() => openEdit(r)} className="text-xs text-ink-secondary hover:text-amber">Изменить</button>
                        <button onClick={() => { if (confirm(`Удалить рубрику «${r.name}»?`)) deleteMut.mutate(r.id) }}
                          className="text-xs text-ink-tertiary hover:text-danger">Удалить</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function pluralCriteria(n: number): string {
  const mod10 = n % 10, mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'критерий'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'критерия'
  return 'критериев'
}
