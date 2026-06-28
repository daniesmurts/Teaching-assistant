import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../components/ui/Button'
import { useUIStore } from '../store/uiStore'
import {
  getPublishedAssignment, updatePublishedAssignment, addInvite, deleteInvite, writeUrl,
  type PublishedStatus, type InviteStatus,
} from '../api/publishedAssignments'

const STATUS_LABEL: Record<PublishedStatus, string> = {
  draft: 'Черновик', open: 'Опубликовано', closed: 'Закрыто',
}
const INVITE_LABEL: Record<InviteStatus, string> = {
  invited: 'Приглашён', writing: 'Пишет', submitted: 'Сдано',
}
const INVITE_STYLE: Record<InviteStatus, string> = {
  invited:   'bg-surface-warm text-ink-tertiary',
  writing:   'bg-warning-bg text-warning',
  submitted: 'bg-success-bg text-success',
}

export default function PublishedAssignmentDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data, isLoading } = useQuery({
    queryKey: ['published-assignment', id],
    queryFn: () => getPublishedAssignment(id),
  })

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['published-assignment', id] })
    qc.invalidateQueries({ queryKey: ['published-assignments'] })
  }
  const onError = (e: any) => addToast(e?.response?.data?.error ?? 'Не удалось сохранить', 'error')

  const statusMut = useMutation({
    mutationFn: (status: PublishedStatus) => updatePublishedAssignment(id, { status }),
    onSuccess: () => { invalidate(); addToast('Статус обновлён', 'success') }, onError,
  })
  const addMut = useMutation({
    mutationFn: () => addInvite(id, { student_name: name.trim() || null, student_email: email.trim() || null }),
    onSuccess: () => { invalidate(); setName(''); setEmail(''); addToast('Студент добавлен', 'success') }, onError,
  })
  const delMut = useMutation({
    mutationFn: (inviteId: string) => deleteInvite(id, inviteId),
    onSuccess: () => { invalidate(); addToast('Удалено', 'success') }, onError,
  })

  function copyLink(token: string) {
    navigator.clipboard.writeText(writeUrl(token))
      .then(() => addToast('Ссылка скопирована', 'success'))
      .catch(() => addToast('Не удалось скопировать', 'error'))
  }

  if (isLoading || !data) {
    return <div className="flex-1 flex items-center justify-center text-sm font-sans text-ink-secondary">Загрузка…</div>
  }

  const { assignment: a, invites } = data

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 page-enter">
        <button onClick={() => navigate('/published')}
          className="text-xs font-sans text-ink-secondary hover:text-ink mb-4">← К заданиям</button>

        <div className="flex items-start justify-between gap-4 mb-1">
          <h1 className="font-display text-2xl font-bold text-ink">{a.title}</h1>
          <span className="text-xs font-sans px-2 py-1 rounded-sm bg-surface-warm text-ink-secondary flex-shrink-0">
            {STATUS_LABEL[a.status]}
          </span>
        </div>
        {a.instructions && <p className="text-sm font-sans text-ink-secondary whitespace-pre-wrap mb-4">{a.instructions}</p>}

        {/* Status controls */}
        <div className="flex items-center gap-2 mb-6">
          {a.status === 'draft' && (
            <Button onClick={() => statusMut.mutate('open')} loading={statusMut.isPending}>Опубликовать</Button>
          )}
          {a.status === 'open' && (
            <button onClick={() => statusMut.mutate('closed')}
              className="px-4 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">
              Закрыть приём работ
            </button>
          )}
          {a.status === 'closed' && (
            <button onClick={() => statusMut.mutate('open')}
              className="px-4 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm transition-colors">
              Возобновить приём
            </button>
          )}
        </div>

        {/* Roster */}
        <h2 className="font-display text-lg font-bold text-ink mb-1">Студенты</h2>
        <p className="text-sm font-sans text-ink-secondary mb-3">
          Сдано {invites.filter((i) => i.status === 'submitted').length} из {invites.length}. Отправьте каждому персональную ссылку.
        </p>

        <div className="flex flex-wrap items-end gap-2 mb-4 bg-surface-warm border border-border rounded-lg px-3 py-3">
          <label className="block flex-1 min-w-[140px]">
            <span className="text-[11px] font-sans text-ink-secondary block mb-1">Имя</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Иванов И."
              className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong" />
          </label>
          <label className="block flex-1 min-w-[160px]">
            <span className="text-[11px] font-sans text-ink-secondary block mb-1">Email (необязательно)</span>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="student@example.ru"
              className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong" />
          </label>
          <Button onClick={() => name.trim() && addMut.mutate()} loading={addMut.isPending}>Добавить</Button>
        </div>

        {invites.length === 0 ? (
          <div className="text-center py-8 text-sm font-sans text-ink-tertiary">Пока никого нет. Добавьте студентов выше.</div>
        ) : (
          <div className="space-y-1.5">
            {invites.map((inv) => (
              <div key={inv.id} className="flex items-center gap-3 bg-surface border border-border rounded-lg px-3 py-2.5">
                <div className="flex-1 min-w-0">
                  <span className="text-sm font-sans text-ink">{inv.student_name || inv.student_email || 'Без имени'}</span>
                  {inv.student_name && inv.student_email && (
                    <span className="text-xs font-sans text-ink-tertiary ml-2">{inv.student_email}</span>
                  )}
                </div>
                <span className={`text-[11px] font-sans px-1.5 py-0.5 rounded-sm flex-shrink-0 ${INVITE_STYLE[inv.status]}`}>
                  {INVITE_LABEL[inv.status]}
                </span>
                <button onClick={() => copyLink(inv.token)}
                  className="text-xs font-sans text-amber hover:opacity-80 transition-opacity flex-shrink-0">
                  Скопировать ссылку
                </button>
                {inv.status !== 'submitted' && (
                  <button onClick={() => { if (confirm('Удалить студента?')) delMut.mutate(inv.id) }}
                    aria-label="Удалить" title="Удалить"
                    className="text-ink-tertiary hover:text-danger transition-colors text-base leading-none flex-shrink-0">×</button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
