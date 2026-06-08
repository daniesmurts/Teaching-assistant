import { useState, FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import { getInstitutions, createInstitution, updateInstitution, type AdminInstitution } from '../../api/admin'

const PLANS = ['institution', 'pro', 'free']
const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

export default function AdminInstitutions() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [planTier, setPlanTier] = useState('institution')
  const [maxTeachers, setMaxTeachers] = useState('')
  const [emailDomain, setEmailDomain] = useState('')

  const { data: institutions = [] } = useQuery({ queryKey: ['admin-institutions'], queryFn: getInstitutions })

  const createMut = useMutation({
    mutationFn: () => createInstitution({
      name: name.trim(), planTier,
      maxTeachers: maxTeachers.trim() === '' ? null : Number(maxTeachers),
      emailDomain: emailDomain.trim() || null,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-institutions'] })
      setShowForm(false); setName(''); setPlanTier('institution'); setMaxTeachers(''); setEmailDomain('')
      addToast('Организация создана', 'success')
    },
    onError: () => addToast('Не удалось создать организацию', 'error'),
  })

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Parameters<typeof updateInstitution>[1] }) => updateInstitution(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-institutions'] }),
    onError:   () => addToast('Не удалось обновить организацию', 'error'),
  })

  function handleCreate(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    createMut.mutate()
  }

  const inputClass = 'px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Организации</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Создавайте организации и назначайте администраторов на странице «Преподаватели»
            </p>
          </div>
          {!showForm && <Button size="sm" onClick={() => setShowForm(true)}>+ Новая организация</Button>}
        </div>

        {showForm && (
          <form onSubmit={handleCreate} className="bg-surface border border-border rounded-lg p-5 mb-6 space-y-3">
            <input className={`${inputClass} w-full`} placeholder="Название организации" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <div className="flex gap-2">
              <select className={inputClass} value={planTier} onChange={(e) => setPlanTier(e.target.value)}>
                {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input className={`${inputClass} w-40`} type="number" min={1} placeholder="Мест (пусто = ∞)" value={maxTeachers} onChange={(e) => setMaxTeachers(e.target.value)} />
              <input className={`${inputClass} flex-1`} placeholder="Домен авто-входа (напр. mgu.ru)" value={emailDomain} onChange={(e) => setEmailDomain(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-1">
              <Button type="submit" loading={createMut.isPending} disabled={!name.trim()}>Создать</Button>
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">Отмена</button>
            </div>
          </form>
        )}

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                <th className="text-left px-4 py-2 font-medium">Организация</th>
                <th className="text-left px-4 py-2 font-medium">Тариф</th>
                <th className="text-left px-4 py-2 font-medium">Домен</th>
                <th className="text-right px-4 py-2 font-medium">Мест</th>
                <th className="text-right px-4 py-2 font-medium">Преподавателей</th>
                <th className="text-right px-4 py-2 font-medium">Создана</th>
              </tr>
            </thead>
            <tbody>
              {institutions.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-tertiary text-xs">Организаций пока нет.</td></tr>
              ) : (
                institutions.map((inst) => <Row key={inst.id} inst={inst} onPatch={(data) => updateMut.mutate({ id: inst.id, data })} />)
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function Row({ inst, onPatch }: { inst: AdminInstitution; onPatch: (data: { planTier?: string; maxTeachers?: number | null; emailDomain?: string | null }) => void }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2.5 text-ink font-medium">{inst.name}</td>
      <td className="px-4 py-2.5">
        <select
          value={inst.plan_tier}
          onChange={(e) => onPatch({ planTier: e.target.value })}
          className="text-xs font-sans bg-surface border border-border rounded-md px-2 py-1"
        >
          {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <input
          defaultValue={inst.email_domain ?? ''}
          placeholder="—"
          onBlur={(e) => {
            const v = e.target.value.trim()
            if (v !== (inst.email_domain ?? '')) onPatch({ emailDomain: v || null })
          }}
          className="w-32 text-xs font-sans bg-surface border border-border rounded-md px-2 py-1"
        />
      </td>
      <td className="px-4 py-2.5 text-right">
        <input
          type="number" min={1}
          defaultValue={inst.max_teachers ?? ''}
          placeholder="∞"
          onBlur={(e) => {
            const v = e.target.value.trim()
            const next = v === '' ? null : Number(v)
            if (next !== inst.max_teachers) onPatch({ maxTeachers: next })
          }}
          className="w-16 text-xs font-sans bg-surface border border-border rounded-md px-2 py-1 text-right"
        />
      </td>
      <td className="px-4 py-2.5 text-right text-ink">{inst.teacher_count}</td>
      <td className="px-4 py-2.5 text-right text-ink-tertiary text-xs">{fmt(inst.created_at)}</td>
    </tr>
  )
}
