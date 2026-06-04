import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import Button from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { getCourses } from '../api/courses'
import {
  getRubrics, getRubricTemplates, createRubric, updateRubric, deleteRubric,
  type RubricPayload,
} from '../api/rubrics'
import { useUIStore } from '../store/uiStore'
import type { Rubric, RubricCriterion } from '../types'

const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

const emptyCriterion = (): RubricCriterion => ({ name: '', weight: 25, max_score: 100, description: '' })

interface FormState {
  id?: string
  name: string
  course_id: string
  criteria: RubricCriterion[]
}
const emptyForm: FormState = { name: '', course_id: '', criteria: [emptyCriterion()] }

export default function Rubrics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data: rubrics = [] }  = useQuery({ queryKey: ['rubrics-all'], queryFn: () => getRubrics() })
  const { data: courses = [] }  = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: templates = [] } = useQuery({ queryKey: ['rubric-templates'], queryFn: getRubricTemplates })

  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const payload: RubricPayload = {
        name: f.name,
        course_id: f.course_id || undefined,
        criteria: f.criteria,
      }
      return f.id ? updateRubric(f.id, payload) : createRubric(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['rubrics-all'] })
      qc.invalidateQueries({ queryKey: ['rubrics'] })  // grading form dropdown
      addToast('Рубрика сохранена', 'success')
      close()
    },
    onError: () => addToast('Не удалось сохранить рубрику', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteRubric,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['rubrics-all'] }); qc.invalidateQueries({ queryKey: ['rubrics'] }) },
    onError:   () => addToast('Не удалось удалить рубрику', 'error'),
  })

  function close() { setShowForm(false); setForm(emptyForm) }

  function openNew() { setForm(emptyForm); setShowForm(true) }
  function openEdit(r: Rubric) {
    setForm({ id: r.id, name: r.name, course_id: r.course_id ?? '', criteria: r.criteria.length ? r.criteria : [emptyCriterion()] })
    setShowForm(true)
  }
  function fromTemplate(name: string, criteria: RubricCriterion[]) {
    setForm({ name, course_id: '', criteria: criteria.map((c) => ({ ...c })) })
    setShowForm(true)
  }

  const setCrit = (i: number, field: keyof RubricCriterion, value: string | number) =>
    setForm((f) => ({ ...f, criteria: f.criteria.map((c, idx) => idx === i ? { ...c, [field]: value } : c) }))

  function submit() {
    if (!form.name.trim())                         { addToast('Введите название рубрики', 'error'); return }
    if (form.criteria.some((c) => !c.name.trim())) { addToast('Заполните названия всех критериев', 'error'); return }
    saveMut.mutate(form)
  }

  const totalWeight = form.criteria.reduce((s, c) => s + (Number(c.weight) || 0), 0)
  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Критерии оценки"
        actions={!showForm && <Button size="sm" onClick={openNew}>+ Новая рубрика</Button>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">

          {showForm ? (
            <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
              <h2 className="font-display text-lg font-bold text-ink">
                {form.id ? 'Редактировать рубрику' : 'Новая рубрика'}
              </h2>

              <div className="grid grid-cols-[1fr_220px] gap-3">
                <Input label="Название" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Эссе — критерии оценки" />
                <div>
                  <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Курс</label>
                  <select className={inputClass + ' py-2'} value={form.course_id}
                    onChange={(e) => setForm((f) => ({ ...f, course_id: e.target.value }))}>
                    <option value="">Все курсы</option>
                    {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              {/* Criteria builder */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Критерии</span>
                  <span className={`text-xs font-sans ${totalWeight === 100 ? 'text-success' : 'text-ink-tertiary'}`}>
                    Сумма весов: {totalWeight}{totalWeight !== 100 && ' (обычно 100)'}
                  </span>
                </div>
                <div className="grid grid-cols-[1fr_70px_70px_28px] gap-2 mb-1 text-[10px] font-sans text-ink-tertiary uppercase">
                  <span>Название</span><span className="text-center">Вес</span><span className="text-center">Макс</span><span />
                </div>
                <div className="space-y-3">
                  {form.criteria.map((c, i) => (
                    <div key={i} className="space-y-1">
                      <div className="grid grid-cols-[1fr_70px_70px_28px] gap-2 items-center">
                        <input className={inputClass} placeholder="Напр. Анализ источников" value={c.name} onChange={(e) => setCrit(i, 'name', e.target.value)} />
                        <input className={inputClass + ' text-center'} type="number" value={c.weight} onChange={(e) => setCrit(i, 'weight', Number(e.target.value))} />
                        <input className={inputClass + ' text-center'} type="number" value={c.max_score} onChange={(e) => setCrit(i, 'max_score', Number(e.target.value))} />
                        <button onClick={() => setForm((f) => ({ ...f, criteria: f.criteria.filter((_, idx) => idx !== i) }))}
                          disabled={form.criteria.length === 1}
                          className="text-ink-tertiary hover:text-danger disabled:opacity-30">×</button>
                      </div>
                      <input className={inputClass + ' text-xs text-ink-secondary'} placeholder="Что оценивается (необязательно)" value={c.description} onChange={(e) => setCrit(i, 'description', e.target.value)} />
                    </div>
                  ))}
                </div>
                <button onClick={() => setForm((f) => ({ ...f, criteria: [...f.criteria, emptyCriterion()] }))}
                  className="text-xs text-amber hover:underline mt-2">+ критерий</button>
              </div>

              <div className="flex gap-2 pt-1">
                <Button size="sm" loading={saveMut.isPending} onClick={submit}>Сохранить</Button>
                <Button size="sm" variant="secondary" onClick={close}>Отмена</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Templates to start from */}
              {templates.length > 0 && (
                <div className="mb-6">
                  <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
                    Начать с готового шаблона
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((t) => (
                      <button key={t.id} onClick={() => fromTemplate(t.name, t.criteria)}
                        className="px-3 py-1.5 text-xs font-sans bg-surface border border-border rounded-md hover:border-amber/40 hover:bg-amber-light transition-colors">
                        {t.name}
                        {t.template_subject && <span className="text-ink-tertiary ml-1.5">· {SUBJECT_LABEL[t.template_subject] ?? t.template_subject}</span>}
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
                    Создайте рубрику, чтобы ИИ оценивал работы по вашим критериям с разбивкой по каждому.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {rubrics.map((r) => (
                    <div key={r.id} className="bg-surface border border-border rounded-lg p-4 flex items-start justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-sans text-sm font-medium text-ink">{r.name}</span>
                          {r.course_id && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">{courseName(r.course_id) ?? 'курс'}</span>}
                        </div>
                        <div className="text-xs font-sans text-ink-tertiary mt-1">
                          {r.criteria.map((c) => `${c.name} (${c.weight})`).join(' · ')}
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
