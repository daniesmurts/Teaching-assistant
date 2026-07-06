import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Button from '../components/ui/Button'
import CreateButton from '../components/ui/CreateButton'
import { Input } from '../components/ui/Input'
import TemplatePicker from '../components/ui/TemplatePicker'
import { getCourses } from '../api/courses'
import {
  getCriteria, getCriteriaTemplates, createCriterion, updateCriterion, deleteCriterion,
  type CriterionPayload,
} from '../api/criteria'
import { useUIStore } from '../store/uiStore'
import type { Criterion, CriterionSubject } from '../types'

const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

const SUBJECTS: CriterionSubject[] = [
  'general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities',
]

interface FormState {
  id?:          string
  name:         string
  description:  string
  course_id:    string
  subject:      CriterionSubject | ''
}
const emptyForm: FormState = { name: '', description: '', course_id: '', subject: '' }

export default function Criteria() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(emptyForm)

  const { data: criteria = [] }  = useQuery({ queryKey: ['criteria-all'], queryFn: () => getCriteria() })
  const { data: courses = [] }   = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: templates = [] } = useQuery({ queryKey: ['criteria-templates'], queryFn: getCriteriaTemplates })

  const courseName = (id: string | null) => courses.find((c) => c.id === id)?.name

  const saveMut = useMutation({
    mutationFn: (f: FormState) => {
      const payload: CriterionPayload = {
        name:        f.name,
        description: f.description || null,
        course_id:   f.course_id || undefined,
        subject:     f.subject || undefined,
      }
      return f.id ? updateCriterion(f.id, payload) : createCriterion(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criteria-all'] })
      qc.invalidateQueries({ queryKey: ['criteria'] })
      addToast('Критерий сохранён', 'success')
      close()
    },
    onError: () => addToast('Не удалось сохранить критерий', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteCriterion,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['criteria-all'] })
      qc.invalidateQueries({ queryKey: ['criteria'] })
    },
    onError:   () => addToast('Не удалось удалить критерий', 'error'),
  })

  function close() { setShowForm(false); setForm(emptyForm) }

  function openNew() { setForm(emptyForm); setShowForm(true) }
  function openEdit(c: Criterion) {
    setForm({
      id: c.id, name: c.name,
      description: c.description ?? '',
      course_id: c.course_id ?? '',
      subject: c.subject ?? '',
    })
    setShowForm(true)
  }
  function fromTemplate(t: Criterion) {
    setForm({
      name: t.name,
      description: t.description ?? '',
      course_id: '',
      subject: t.subject ?? '',
    })
    setShowForm(true)
  }

  function submit() {
    if (!form.name.trim()) { addToast('Введите название критерия', 'error'); return }
    saveMut.mutate(form)
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Критерии оценки"
        actions={!showForm && <CreateButton onClick={openNew}>Новый критерий</CreateButton>}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto px-4 md:px-6 py-6">

          {!showForm && (
            <FeatureIntro
              id="criteria"
              videoSlug="criteria"
              title="Критерии оценки — отдельные правила, которые ИСПУМ применяет к работе"
              description="Создайте библиотеку критериев — отдельных правил оценки (например «Аргументация», «Структура», «Правильность ответа»). При проверке работы выбирайте один или несколько критериев и задавайте их веса в процентах — в сумме они должны давать 100%. Без выбранных критериев проверка идёт по общим академическим стандартам."
              steps={[
                'Создайте критерий с нуля или начните с готового шаблона по вашей дисциплине.',
                'Добавьте краткое описание того, что считается хорошим ответом по этому критерию.',
                'При проверке работы выберите один или несколько критериев и задайте веса.',
                'Один и тот же критерий можно переиспользовать для любых заданий и предметов.',
              ]}
            />
          )}

          {showForm ? (
            <div className="max-w-2xl bg-surface border border-border rounded-lg p-5 space-y-4">
              <h2 className="font-display text-lg font-bold text-ink">
                {form.id ? 'Редактировать критерий' : 'Новый критерий'}
              </h2>

              <Input label="Название" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Напр. Аргументация" />

              <div>
                <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Описание</label>
                <textarea
                  className={`${inputClass} resize-none`}
                  rows={3}
                  placeholder="Что именно оценивается — это попадает в подсказку ИИ при проверке"
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

              <div className="flex gap-2 pt-1">
                <Button size="sm" loading={saveMut.isPending} onClick={submit}>Сохранить</Button>
                <Button size="sm" variant="secondary" onClick={close}>Отмена</Button>
              </div>
            </div>
          ) : (
            <>
              {/* Templates — search + subject filter when the list grows */}
              <TemplatePicker
                items={templates}
                subjectLabel={SUBJECT_LABEL}
                onPick={(t) => fromTemplate(t as Criterion)}
              />

              {/* Existing criteria */}
              {criteria.length === 0 ? (
                <div className="text-center py-12">
                  <p className="font-sans text-sm text-ink-secondary mb-1">У вас пока нет критериев.</p>
                  <p className="font-sans text-xs text-ink-tertiary">
                    Создайте критерий, чтобы выбирать его при проверке работ и задавать вес в процентах.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {criteria.map((c) => (
                    <div key={c.id} className="bg-surface border border-border rounded-lg p-4 flex flex-col">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-sans text-sm font-medium text-ink">{c.name}</span>
                          {c.subject && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">{SUBJECT_LABEL[c.subject] ?? c.subject}</span>}
                          {c.course_id && <span className="text-[10px] bg-surface-warm text-ink-secondary border border-border px-1.5 py-0.5 rounded-sm">{courseName(c.course_id) ?? 'предмет'}</span>}
                          {c.is_institution_shared && <span className="text-[10px] bg-info-bg text-info px-1.5 py-0.5 rounded-sm">кафедра</span>}
                        </div>
                        {c.description && (
                          <div className="text-xs font-sans text-ink-tertiary mt-1 leading-relaxed line-clamp-3">{c.description}</div>
                        )}
                      </div>
                      <div className="flex gap-2 flex-shrink-0 mt-3 pt-2 border-t border-border/60">
                        <button onClick={() => openEdit(c)} className="text-xs text-ink-secondary hover:text-amber">Изменить</button>
                        <button onClick={() => { if (confirm(`Удалить критерий «${c.name}»?`)) deleteMut.mutate(c.id) }}
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
