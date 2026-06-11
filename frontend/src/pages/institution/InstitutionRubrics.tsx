import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import { getInstitutionCriteria, createInstitutionCriterion } from '../../api/institution'
import type { CriterionSubject } from '../../types'

const SUBJECTS: CriterionSubject[] = [
  'general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities',
]
const SUBJECT_LABEL: Record<string, string> = {
  business: 'Бизнес', economics: 'Экономика', law: 'Право', medicine: 'Медицина',
  engineering: 'Инженерия', humanities: 'Гуманитарные', general: 'Общий',
}

export default function InstitutionRubrics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm]       = useState(false)
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [subject, setSubject]         = useState<CriterionSubject | ''>('')

  const { data: criteria = [] } = useQuery({ queryKey: ['inst-criteria'], queryFn: getInstitutionCriteria })

  const createMut = useMutation({
    mutationFn: () => createInstitutionCriterion({
      name:        name.trim(),
      description: description.trim() || undefined,
      subject:     subject || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inst-criteria'] })
      setShowForm(false); setName(''); setDescription(''); setSubject('')
      addToast('Критерий создан', 'success')
    },
    onError: () => addToast('Не удалось создать критерий', 'error'),
  })

  const canSave = name.trim().length > 0
  const inputClass = 'px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Критерии организации</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">Общие критерии оценки для преподавателей организации</p>
          </div>
          {!showForm && <Button size="sm" onClick={() => setShowForm(true)}>+ Новый критерий</Button>}
        </div>

        {showForm && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6 space-y-3">
            <div className="grid grid-cols-[1fr_180px] gap-3">
              <input className={`${inputClass}`} placeholder="Название критерия" value={name} onChange={(e) => setName(e.target.value)} />
              <select className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value as CriterionSubject | '')}>
                <option value="">Область — не указана</option>
                {SUBJECTS.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s]}</option>)}
              </select>
            </div>
            <textarea
              className={`${inputClass} w-full resize-none`}
              rows={3}
              placeholder="Описание — что именно оценивается (попадает в подсказку ИИ)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
              <Button onClick={() => createMut.mutate()} loading={createMut.isPending} disabled={!canSave}>Сохранить</Button>
              <button onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">Отмена</button>
            </div>
          </div>
        )}

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {criteria.length === 0 ? (
            <p className="text-sm font-sans text-ink-secondary text-center py-8">Общих критериев пока нет.</p>
          ) : (
            criteria.map((c, i, arr) => (
              <div key={c.id} className={`px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-sans font-medium text-ink">{c.name}</span>
                  {c.subject && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">{SUBJECT_LABEL[c.subject] ?? c.subject}</span>}
                </div>
                <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                  {c.description ?? '—'}{c.author_name ? ` · автор: ${c.author_name}` : ''}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
