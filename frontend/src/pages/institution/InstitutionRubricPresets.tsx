import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { Input } from '../../components/ui/Input'
import { useUIStore } from '../../store/uiStore'
import { getInstitutionRubrics, createInstitutionRubric } from '../../api/institution'
import { getCriteria } from '../../api/criteria'
import { evenWeights } from '../../components/grading/GradingForm'
import type { CriterionSubject, RubricItem } from '../../types'

const SUBJECTS: CriterionSubject[] = [
  'general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities',
]
const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

interface PickedItem extends RubricItem { name: string }

/**
 * Institution admin creates shared rubrics — appear in every member's «Рубрики»
 * library. Criteria are picked from the admin's library + shared + global.
 */
export default function InstitutionRubricPresets() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const [showForm, setShowForm]       = useState(false)
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [subject, setSubject]         = useState<CriterionSubject | ''>('')
  const [picked, setPicked]           = useState<PickedItem[]>([])

  const { data: rubrics = [] }  = useQuery({ queryKey: ['inst-rubrics'],  queryFn: getInstitutionRubrics })
  const { data: criteria = [] } = useQuery({ queryKey: ['criteria-all'],  queryFn: () => getCriteria() })

  const criterionById = useMemo(() => new Map(criteria.map((c) => [c.id, c])), [criteria])
  const pickedIds = new Set(picked.map((p) => p.criterion_id))
  const available = criteria.filter((c) => !pickedIds.has(c.id))
  const weightTotal = picked.reduce((s, p) => s + p.weight, 0)
  const weightsValid = picked.length > 0 && weightTotal === 100

  const createMut = useMutation({
    mutationFn: () => createInstitutionRubric({
      name:        name.trim(),
      description: description.trim() || undefined,
      subject:     subject || undefined,
      items:       picked.map((p) => ({ criterion_id: p.criterion_id, weight: p.weight })),
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inst-rubrics'] })
      reset()
      addToast('Рубрика создана', 'success')
    },
    onError: () => addToast('Не удалось создать рубрику', 'error'),
  })

  function reset() { setShowForm(false); setName(''); setDescription(''); setSubject(''); setPicked([]) }

  function addCriterion(id: string) {
    if (!id) return
    const c = criterionById.get(id); if (!c) return
    setPicked((prev) => {
      const next: PickedItem[] = [...prev, { criterion_id: id, weight: 0, name: c.name }]
      const w = evenWeights(next.length)
      return next.map((p, i) => ({ ...p, weight: w[i] }))
    })
  }
  function removeCriterion(id: string) {
    setPicked((prev) => {
      const next = prev.filter((p) => p.criterion_id !== id)
      const w = evenWeights(next.length)
      return next.map((p, i) => ({ ...p, weight: w[i] }))
    })
  }
  function setWeight(id: string, weight: number) {
    setPicked((prev) => prev.map((p) => p.criterion_id === id ? { ...p, weight } : p))
  }
  function submit() {
    if (!name.trim())       { addToast('Введите название рубрики', 'error'); return }
    if (picked.length === 0){ addToast('Добавьте хотя бы один критерий', 'error'); return }
    if (!weightsValid)      { addToast(`Сумма весов должна быть 100% (сейчас ${weightTotal}%)`, 'error'); return }
    createMut.mutate()
  }

  const inputClass = 'w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'
  const weightInputClass = 'w-14 px-1.5 py-1 text-xs font-sans text-ink bg-surface border border-border rounded-md text-center'

  return (
    <div className="px-6 py-6 max-w-3xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Рубрики кафедры</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Общие рубрики появляются в библиотеке у всех преподавателей кафедры.
          </p>
        </div>
        {!showForm && <CreateButton onClick={() => setShowForm(true)}>Новая рубрика</CreateButton>}
      </div>

      {showForm ? (
        <div className="bg-surface border border-border rounded-lg p-5 space-y-4">
          <Input label="Название" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Напр. Эссе по экономике" />

          <div>
            <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Описание</label>
            <textarea className={`${inputClass} resize-none`} rows={2}
              value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>

          <div>
            <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Область</label>
            <select className={inputClass + ' py-2'} value={subject}
              onChange={(e) => setSubject(e.target.value as CriterionSubject | '')}>
              <option value="">—</option>
              {SUBJECTS.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-sans font-medium text-ink-secondary mb-1">Критерии и веса</label>
            <select className={inputClass + ' py-2'} value="" onChange={(e) => addCriterion(e.target.value)}>
              <option value="">{picked.length === 0 ? 'Выберите критерий…' : '+ Добавить критерий'}</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.subject ? ` · ${SUBJECT_LABEL[c.subject] ?? c.subject}` : ''}
                </option>
              ))}
            </select>

            {picked.length > 0 && (
              <div className="space-y-1.5 pt-2">
                {picked.map((p) => (
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
            <Button size="sm" loading={createMut.isPending} onClick={submit}>Создать</Button>
            <Button size="sm" variant="secondary" onClick={reset}>Отмена</Button>
          </div>
        </div>
      ) : rubrics.length === 0 ? (
        <div className="text-center py-12">
          <p className="font-sans text-sm text-ink-secondary mb-1">Общих рубрик пока нет.</p>
          <p className="font-sans text-xs text-ink-tertiary">
            Создайте рубрику — она появится в библиотеке у всех преподавателей кафедры.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rubrics.map((r) => (
            <div key={r.id} className="bg-surface border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-sans text-sm font-medium text-ink">{r.name}</span>
                {r.subject && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">{SUBJECT_LABEL[r.subject] ?? r.subject}</span>}
                <span className="text-[10px] text-ink-tertiary">{r.items.length} критериев</span>
                {r.author_name && <span className="text-[10px] text-ink-tertiary">· {r.author_name}</span>}
              </div>
              {r.description && (
                <div className="text-xs font-sans text-ink-tertiary mt-1 leading-relaxed">{r.description}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
