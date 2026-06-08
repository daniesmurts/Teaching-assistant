import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import { getInstitutionRubrics, createInstitutionRubric } from '../../api/institution'
import type { RubricCriterion } from '../../types'

const emptyCriterion = (): RubricCriterion => ({ name: '', weight: 25, max_score: 100, description: '' })

export default function InstitutionRubrics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [criteria, setCriteria] = useState<RubricCriterion[]>([emptyCriterion()])

  const { data: rubrics = [] } = useQuery({ queryKey: ['inst-rubrics'], queryFn: getInstitutionRubrics })

  const createMut = useMutation({
    mutationFn: () => createInstitutionRubric({ name: name.trim(), criteria }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inst-rubrics'] })
      setShowForm(false); setName(''); setCriteria([emptyCriterion()])
      addToast('Рубрика создана', 'success')
    },
    onError: () => addToast('Не удалось создать рубрику', 'error'),
  })

  const setCriterion = (i: number, patch: Partial<RubricCriterion>) =>
    setCriteria((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))

  const canSave = name.trim() && criteria.every((c) => c.name.trim()) && criteria.length > 0

  const inputClass = 'px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Рубрики организации</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">Общие критерии оценки для преподавателей организации</p>
          </div>
          {!showForm && <Button size="sm" onClick={() => setShowForm(true)}>+ Новая рубрика</Button>}
        </div>

        {showForm && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6 space-y-3">
            <input className={`${inputClass} w-full`} placeholder="Название рубрики" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="space-y-2">
              {criteria.map((c, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <input className={`${inputClass} flex-1`} placeholder="Критерий" value={c.name} onChange={(e) => setCriterion(i, { name: e.target.value })} />
                  <input className={`${inputClass} w-20`} type="number" min={0} max={100} value={c.weight} onChange={(e) => setCriterion(i, { weight: Number(e.target.value) })} title="Вес %" />
                  {criteria.length > 1 && (
                    <button onClick={() => setCriteria((cs) => cs.filter((_, idx) => idx !== i))} className="px-2 py-2 text-ink-tertiary hover:text-danger" title="Удалить">×</button>
                  )}
                </div>
              ))}
              <button onClick={() => setCriteria((cs) => [...cs, emptyCriterion()])} className="text-xs font-sans text-amber hover:underline">+ Добавить критерий</button>
            </div>
            <div className="flex gap-2 pt-1">
              <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!canSave}>Сохранить</Button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">Отмена</button>
            </div>
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {rubrics.length === 0 ? (
            <p className="text-sm font-sans text-ink-secondary text-center py-8">Общих рубрик пока нет.</p>
          ) : (
            rubrics.map((r, i, arr) => (
              <div key={r.id} className={`px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="text-sm font-sans font-medium text-ink">{r.name}</div>
                <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                  {r.criteria.length} критериев{r.author_name ? ` · автор: ${r.author_name}` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
