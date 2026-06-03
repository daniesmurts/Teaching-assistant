import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getRubricTemplates, createRubricTemplate, deleteRubricTemplate,
  type RubricTemplateCriterion,
} from '../../api/admin'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'

const SUBJECTS = ['business', 'economics', 'law', 'medicine', 'engineering', 'humanities', 'general']

const emptyCriterion = (): RubricTemplateCriterion => ({ name: '', weight: 25, max_score: 100, description: '' })

export default function AdminRubrics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [name, setName]         = useState('')
  const [subject, setSubject]   = useState('general')
  const [criteria, setCriteria] = useState<RubricTemplateCriterion[]>([emptyCriterion()])

  const { data: templates = [] } = useQuery({ queryKey: ['admin-templates'], queryFn: getRubricTemplates })

  const createMut = useMutation({
    mutationFn: createRubricTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-templates'] })
      addToast('Шаблон создан', 'success')
      setShowForm(false); setName(''); setSubject('general'); setCriteria([emptyCriterion()])
    },
    onError: () => addToast('Не удалось создать шаблон', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteRubricTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-templates'] }),
  })

  const setCrit = (i: number, field: keyof RubricTemplateCriterion, value: string | number) =>
    setCriteria((cs) => cs.map((c, idx) => idx === i ? { ...c, [field]: value } : c))

  function submit() {
    if (!name.trim() || criteria.some((c) => !c.name.trim())) {
      addToast('Заполните название и все критерии', 'error'); return
    }
    createMut.mutate({ name, template_subject: subject, criteria })
  }

  const inputClass = 'px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-display text-2xl font-bold text-ink">Шаблоны рубрик</h1>
          {!showForm && <Button size="sm" onClick={() => setShowForm(true)}>+ Новый шаблон</Button>}
        </div>

        {showForm && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6 space-y-3">
            <div className="grid grid-cols-[1fr_180px] gap-3">
              <input className={inputClass} placeholder="Название шаблона" value={name} onChange={(e) => setName(e.target.value)} />
              <select className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider pt-1">Критерии</div>
            {criteria.map((c, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px_80px_28px] gap-2 items-center">
                <input className={inputClass} placeholder="Название критерия" value={c.name} onChange={(e) => setCrit(i, 'name', e.target.value)} />
                <input className={inputClass} type="number" placeholder="вес" value={c.weight} onChange={(e) => setCrit(i, 'weight', Number(e.target.value))} />
                <input className={inputClass} type="number" placeholder="макс" value={c.max_score} onChange={(e) => setCrit(i, 'max_score', Number(e.target.value))} />
                <button onClick={() => setCriteria((cs) => cs.filter((_, idx) => idx !== i))} className="text-ink-tertiary hover:text-danger">×</button>
              </div>
            ))}
            <button onClick={() => setCriteria((cs) => [...cs, emptyCriterion()])} className="text-xs text-amber hover:underline">+ критерий</button>

            <div className="flex gap-2 pt-2">
              <Button size="sm" loading={createMut.isPending} onClick={submit}>Создать</Button>
              <Button size="sm" variant="secondary" onClick={() => setShowForm(false)}>Отмена</Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="bg-surface border border-border rounded-lg p-4 flex items-start justify-between">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-sans text-sm font-medium text-ink">{t.name}</span>
                  <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm font-sans">{t.template_subject}</span>
                </div>
                <div className="text-xs font-sans text-ink-tertiary mt-1">
                  {t.criteria.map((c) => c.name).join(' · ')}
                </div>
              </div>
              <button
                onClick={() => { if (confirm(`Удалить шаблон «${t.name}»?`)) deleteMut.mutate(t.id) }}
                className="text-xs text-ink-tertiary hover:text-danger flex-shrink-0 ml-3"
              >
                Удалить
              </button>
            </div>
          ))}
          {templates.length === 0 && !showForm && (
            <div className="text-center py-12 text-sm font-sans text-ink-tertiary">Шаблонов пока нет.</div>
          )}
        </div>
      </div>
    </div>
  )
}
