import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  getCriterionTemplates, createCriterionTemplate, deleteCriterionTemplate,
} from '../../api/admin'
import Button from '../../components/ui/Button'
import CreateButton from '../../components/ui/CreateButton'
import { useUIStore } from '../../store/uiStore'

const SUBJECTS = ['general', 'business', 'economics', 'law', 'medicine', 'engineering', 'humanities']

export default function AdminRubrics() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [name, setName]               = useState('')
  const [description, setDescription] = useState('')
  const [subject, setSubject]         = useState('general')

  const { data: templates = [] } = useQuery({ queryKey: ['admin-templates'], queryFn: getCriterionTemplates })

  const createMut = useMutation({
    mutationFn: createCriterionTemplate,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-templates'] })
      addToast('Шаблон создан', 'success')
      setShowForm(false); setName(''); setDescription(''); setSubject('general')
    },
    onError: () => addToast('Не удалось создать шаблон', 'error'),
  })

  const deleteMut = useMutation({
    mutationFn: deleteCriterionTemplate,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-templates'] }),
  })

  function submit() {
    if (!name.trim()) { addToast('Введите название критерия', 'error'); return }
    createMut.mutate({ name: name.trim(), description: description.trim() || undefined, subject })
  }

  const inputClass = 'px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-5">
          <h1 className="font-display text-2xl font-bold text-ink">Шаблоны критериев</h1>
          {!showForm && <CreateButton onClick={() => setShowForm(true)}>Новый критерий</CreateButton>}
        </div>

        {showForm && (
          <div className="bg-surface border border-border rounded-lg p-5 mb-6 space-y-3">
            <div className="grid grid-cols-[1fr_180px] gap-3">
              <input className={inputClass} placeholder="Название критерия" value={name} onChange={(e) => setName(e.target.value)} />
              <select className={inputClass} value={subject} onChange={(e) => setSubject(e.target.value)}>
                {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <textarea
              className={`${inputClass} w-full resize-none`}
              rows={3}
              placeholder="Описание — что именно оценивается (попадает в подсказку для проверки)"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div className="flex gap-2 pt-1">
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
                  {t.subject && <span className="text-[10px] bg-amber-light text-amber px-1.5 py-0.5 rounded-sm font-sans">{t.subject}</span>}
                </div>
                {t.description && (
                  <div className="text-xs font-sans text-ink-tertiary mt-1">{t.description}</div>
                )}
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
