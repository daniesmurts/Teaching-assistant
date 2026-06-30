import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRubricTemplates, createRubricTemplate, updateRubricTemplate, deleteRubricTemplate,
  getCriterionTemplates, type RubricTemplatePayload,
} from '../../api/admin'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { Input } from '../../components/ui/Input'
import { evenWeights } from '../../components/grading/GradingForm'
import { useUIStore } from '../../store/uiStore'
import type { Rubric, RubricItem } from '../../types'

const SUBJECTS = ['general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities']
const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

interface PickedItem extends RubricItem { name: string }
interface FormState {
  id?:         string
  name:        string
  description: string
  subject:     string
  picked:      PickedItem[]
}
const emptyForm: FormState = { name: '', description: '', subject: 'general', picked: [] }

/**
 * Global rubric template editor (platform_admin only). Templates are composed
 * from global *criterion* templates so they resolve for every teacher.
 */
export default function AdminRubricTemplates() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data: rubrics = [] }     = useQuery({ queryKey: ['admin-rubric-templates'],  queryFn: getRubricTemplates })
  const { data: criteria = [] }    = useQuery({ queryKey: ['admin-criterion-templates'], queryFn: getCriterionTemplates })

  const criterionById = useMemo(() => new Map(criteria.map((c) => [c.id, c])), [criteria])
  const pickedIds = new Set(form.picked.map((p) => p.criterion_id))
  const available = criteria.filter((c) => !pickedIds.has(c.id))
  const weightTotal = form.picked.reduce((s, p) => s + p.weight, 0)
  const weightsValid = form.picked.length > 0 && weightTotal === 100

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const payload: RubricTemplatePayload = {
        name:        f.name,
        description: f.description || null,
        subject:     f.subject || 'general',
        items:       f.picked.map((p) => ({ criterion_id: p.criterion_id, weight: p.weight })),
      }
      return f.id ? updateRubricTemplate(f.id, payload) : createRubricTemplate(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-rubric-templates'] })
      addToast('Шаблон рубрики сохранён', 'success')
      close()
    },
    onError: () => addToast('Не удалось сохранить шаблон', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteRubricTemplate,
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['admin-rubric-templates'] }),
    onError:    () => addToast('Не удалось удалить шаблон', 'error'),
  })

  function close() { setShowForm(false); setForm(emptyForm) }
  function openNew() { setForm(emptyForm); setShowForm(true) }
  function openEdit(r: Rubric) {
    setForm({
      id:          r.id,
      name:        r.name,
      description: r.description ?? '',
      subject:     r.subject ?? 'general',
      picked:      r.items
        .map((it) => {
          const c = criterionById.get(it.criterion_id)
          return c ? { criterion_id: it.criterion_id, weight: it.weight, name: c.name } : null
        })
        .filter((x): x is PickedItem => x !== null),
    })
    setShowForm(true)
  }
  function addCriterion(id: string) {
    if (!id) return
    const c = criterionById.get(id); if (!c) return
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
    setForm((f) => ({ ...f, picked: f.picked.map((p) => p.criterion_id === id ? { ...p, weight } : p) }))
  }
  function submit() {
    if (!form.name.trim())    { addToast('Введите название шаблона', 'error'); return }
    if (!form.picked.length)  { addToast('Добавьте хотя бы один критерий', 'error'); return }
    if (!weightsValid)        { addToast(`Сумма весов должна быть 100% (сейчас ${weightTotal}%)`, 'error'); return }
    saveMut.mutate(form)
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'
  const weightInputClass = 'w-14 px-1.5 py-1 text-xs font-sans text-ink bg-surface border border-border rounded-md text-center'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Шаблоны рубрик</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Готовые наборы критериев с весами, видимые всем преподавателям как стартовые шаблоны.
          </p>
        </div>
        {!showForm && <CreateButton onClick={openNew}>Новый шаблон</CreateButton>}
      </div>

      {showForm ? (
        <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <h2 className="font-display text-lg font-bold text-ink">
            {form.id ? 'Редактировать шаблон' : 'Новый шаблон рубрики'}
          </h2>

          <Input label="Название" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Напр. Эссе по экономике" />

          <div>
            <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Описание</label>
            <textarea
              className={`${inputClass} resize-none`}
              rows={2}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </div>

          <div>
            <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Область</label>
            <select className={inputClass + ' py-2'} value={form.subject}
              onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}>
              {SUBJECTS.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
            </select>
          </div>

          {/* Picker */}
          <div>
            <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Критерии и веса</label>
            <select className={inputClass + ' py-2'} value="" onChange={(e) => addCriterion(e.target.value)}>
              <option value="">
                {form.picked.length === 0 ? 'Выберите критерий…' : '+ Добавить критерий'}
              </option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.subject ? ` · ${SUBJECT_LABEL[c.subject] ?? c.subject}` : ''}
                </option>
              ))}
            </select>

            {form.picked.length > 0 && (
              <div className="space-y-1.5 pt-2">
                {form.picked.map((p) => (
                  <div key={p.criterion_id} className="flex items-center gap-2 px-2.5 py-1.5 bg-surface-warm border border-border rounded-md">
                    <span className="flex-1 text-sm font-sans text-ink truncate">{p.name}</span>
                    <input type="number" min={0} max={100} value={p.weight}
                      onChange={(e) => setWeight(p.criterion_id, Number(e.target.value))}
                      className={weightInputClass} />
                    <span className="text-xs text-ink-tertiary">%</span>
                    <button type="button" onClick={() => removeCriterion(p.criterion_id)}
                      className="text-ink-tertiary hover:text-danger text-sm leading-none w-5 text-center">×</button>
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
          {rubrics.length === 0 ? (
            <div className="text-center py-12">
              <p className="font-sans text-sm text-ink-secondary mb-1">Шаблонов рубрик пока нет.</p>
              <p className="font-sans text-xs text-ink-tertiary">
                Создайте шаблон — он появится у всех преподавателей в разделе «Рубрики».
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
                      <span className="text-[10px] text-ink-tertiary">{r.items.length} критериев</span>
                    </div>
                    {r.description && (
                      <div className="text-xs font-sans text-ink-tertiary mt-1 leading-relaxed">{r.description}</div>
                    )}
                  </div>
                  <div className="flex gap-2 flex-shrink-0 ml-3">
                    <button onClick={() => openEdit(r)} className="text-xs text-ink-secondary hover:text-amber">Изменить</button>
                    <button onClick={() => { if (confirm(`Удалить шаблон «${r.name}»?`)) deleteMut.mutate(r.id) }}
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
  )
}
