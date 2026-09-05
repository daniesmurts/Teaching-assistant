import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../components/ui/Button'
import { useUIStore } from '../store/uiStore'
import {
  getPublishedAssignment, updatePublishedAssignment, addInvite, addInvitesBulk, deleteInvite, writeUrl,
  getLtiRoster, importLtiRoster, type PublishedStatus, type InviteStatus, type LtiRosterMember,
} from '../api/publishedAssignments'
import CohortSynthesisPanel from '../components/publishedAssignments/CohortSynthesisPanel'
import { usePlan } from '../hooks/usePlan'

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
  const plan = usePlan()

  const { data, isLoading } = useQuery({
    queryKey: ['published-assignment', id],
    queryFn: () => getPublishedAssignment(id),
  })

  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [bulk, setBulk] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)
  const [rosterOpen, setRosterOpen] = useState(false)
  const [rosterPicked, setRosterPicked] = useState<Set<string>>(new Set())

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
  const bulkMut = useMutation({
    mutationFn: () => addInvitesBulk(id, bulk.split('\n').map((l) => l.trim()).filter(Boolean)),
    onSuccess: (res) => {
      invalidate(); setBulk(''); setBulkOpen(false)
      addToast(`Добавлено студентов: ${res.invites.length}`, 'success')
    },
    onError,
  })

  // Срок сдачи. The API and the column have always supported due_at; nothing in
  // the UI ever set it, so «до какого числа» lived only in whatever the teacher
  // typed into the задание text.
  const dueMut = useMutation({
    mutationFn: (due: string | null) => updatePublishedAssignment(id, { due_at: due }),
    onSuccess: () => { invalidate(); addToast('Срок сдачи сохранён', 'success') }, onError,
  })

  const delMut = useMutation({
    mutationFn: (inviteId: string) => deleteInvite(id, inviteId),
    onSuccess: () => { invalidate(); addToast('Удалено', 'success') }, onError,
  })

  const rosterQuery = useQuery({
    queryKey: ['published-assignment-lti-roster', id],
    queryFn:  () => getLtiRoster(id),
  })
  const importMut = useMutation({
    mutationFn: (members: LtiRosterMember[]) => importLtiRoster(id, members),
    onSuccess: (res) => {
      invalidate()
      setRosterOpen(false)
      setRosterPicked(new Set())
      addToast(`Добавлено студентов: ${res.invites.length}`, 'success')
    },
    onError,
  })

  // One link per student is the whole point (§5.1 — a submission has to be
  // attributable), so "share the assignment" means handing out N links. Copying
  // them one at a time is how a teacher loses track at student 12.
  function copyAllLinks(rows: Array<{ student_name: string | null; student_email: string | null; token: string }>) {
    const text = rows
      .map((i) => `${i.student_name || i.student_email || 'Без имени'}\t${writeUrl(i.token)}`)
      .join('\n')
    navigator.clipboard.writeText(text)
      .then(() => addToast(`Скопировано ссылок: ${rows.length}`, 'success'))
      .catch(() => addToast('Не удалось скопировать', 'error'))
  }

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

        <h1 className="font-display text-2xl font-bold text-ink mb-1">{a.title}</h1>
        {a.instructions && <p className="text-sm font-sans text-ink-secondary whitespace-pre-wrap mb-4">{a.instructions}</p>}

        {/* Status bar — current state + the relevant action */}
        <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-lg px-4 py-3 mb-6">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-2 h-2 rounded-full flex-shrink-0 ${
              a.status === 'open' ? 'bg-success' : a.status === 'draft' ? 'bg-amber' : 'bg-ink-tertiary'
            }`} />
            <div className="min-w-0">
              <div className="text-sm font-sans font-medium text-ink">
                {a.status === 'open' ? 'Приём работ открыт' : a.status === 'draft' ? 'Черновик' : 'Приём работ закрыт'}
              </div>
              <div className="text-xs font-sans text-ink-tertiary">
                {a.status === 'open'
                  ? 'Студенты пишут и сдают работы по персональным ссылкам'
                  : a.status === 'draft'
                  ? 'Студенты не видят задание, пока оно не опубликовано'
                  : 'Новые работы не принимаются'}
              </div>
            </div>
          </div>

          {a.status === 'draft' && (
            <Button onClick={() => statusMut.mutate('open')} loading={statusMut.isPending}>Опубликовать</Button>
          )}
          {a.status === 'open' && (
            <button onClick={() => statusMut.mutate('closed')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm hover:text-ink transition-colors disabled:opacity-60 flex-shrink-0">
              <LockIcon /> Закрыть приём
            </button>
          )}
          {a.status === 'closed' && (
            <button onClick={() => statusMut.mutate('open')} disabled={statusMut.isPending}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-md border border-border-mid text-ink-secondary font-sans text-sm hover:bg-surface-warm hover:text-ink transition-colors disabled:opacity-60 flex-shrink-0">
              <UnlockIcon /> Возобновить
            </button>
          )}
        </div>

        {/* Срок сдачи — the "end date" half of what a teacher needs to set up
            after publishing. datetime-local because a deadline in this context
            is a date AND an hour («до 23:59 в пятницу»), and a date-only field
            silently means midnight, which is a different promise. */}
        <div className="flex flex-wrap items-center gap-3 bg-surface border border-border rounded-lg px-4 py-3 mb-6">
          <label className="flex items-center gap-2 flex-1 min-w-[240px]">
            <span className="text-sm font-sans text-ink whitespace-nowrap">Срок сдачи</span>
            <input
              type="datetime-local"
              value={toLocalInput(a.due_at)}
              onChange={(e) => dueMut.mutate(fromLocalInput(e.target.value))}
              className="flex-1 min-w-[180px] text-sm font-sans text-ink bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong"
            />
          </label>
          {a.due_at ? (
            <button
              onClick={() => dueMut.mutate(null)}
              disabled={dueMut.isPending}
              className="text-xs font-sans text-ink-secondary hover:text-danger transition-colors disabled:opacity-40"
            >
              Убрать срок
            </button>
          ) : (
            <span className="text-xs font-sans text-ink-tertiary">Не задан — студенты сдают без ограничения по времени</span>
          )}
        </div>

        {plan.can('cohortSynthesis') && (
          <div className="mb-6">
            <CohortSynthesisPanel
              publishedAssignmentId={id}
              submittedCount={invites.filter((i) => i.status === 'submitted').length}
            />
          </div>
        )}

        {/* Roster */}
        <div className="flex items-center justify-between gap-3 mb-1">
          <h2 className="font-display text-lg font-bold text-ink">Студенты</h2>
          {rosterQuery.data?.available && (
            <button onClick={() => setRosterOpen(true)}
              className="text-xs font-sans font-medium text-amber hover:opacity-80 transition-opacity flex-shrink-0">
              Импортировать из Moodle
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
          <p className="text-sm font-sans text-ink-secondary">
            Сдано {invites.filter((i) => i.status === 'submitted').length} из {invites.length}. У каждого студента своя ссылка.
          </p>
          {invites.length > 0 && (
            <button
              onClick={() => copyAllLinks(invites)}
              className="inline-flex items-center gap-1.5 min-h-[36px] px-3 py-1.5 rounded-md bg-surface border border-border-mid shadow-sm text-xs font-sans font-medium text-ink-secondary hover:bg-surface-warm hover:text-amber transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber"
              title="Имя и ссылка на каждой строке — вставляется в таблицу или рассылку"
            >
              Скопировать все ссылки
            </button>
          )}
        </div>

        {rosterOpen && rosterQuery.data?.available && (
          <div className="mb-4 bg-surface-warm border border-border rounded-lg px-3 py-3">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
              Список студентов из Moodle
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto mb-3">
              {rosterQuery.data.members.map((m) => (
                <label key={m.userId} className="flex items-center gap-2 text-sm font-sans text-ink px-1 py-0.5">
                  <input
                    type="checkbox"
                    checked={rosterPicked.has(m.userId)}
                    onChange={(e) => {
                      const next = new Set(rosterPicked)
                      if (e.target.checked) next.add(m.userId); else next.delete(m.userId)
                      setRosterPicked(next)
                    }}
                  />
                  {m.name || m.email || m.userId}
                  {m.name && m.email && <span className="text-xs text-ink-tertiary">{m.email}</span>}
                </label>
              ))}
              {rosterQuery.data.members.length === 0 && (
                <div className="text-xs font-sans text-ink-tertiary px-1">Список студентов пуст.</div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => importMut.mutate(rosterQuery.data!.available
                  ? rosterQuery.data.members.filter((m) => rosterPicked.has(m.userId))
                  : [])}
                loading={importMut.isPending}
                disabled={rosterPicked.size === 0}
              >
                Добавить выбранных ({rosterPicked.size})
              </Button>
              <Button variant="secondary" onClick={() => setRosterOpen(false)}>Отмена</Button>
            </div>
          </div>
        )}

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
          <button
            type="button"
            onClick={() => setBulkOpen((v) => !v)}
            className="text-xs font-sans text-ink-secondary hover:text-amber transition-colors self-center"
          >
            {bulkOpen ? 'Свернуть' : 'Добавить группу списком'}
          </button>
        </div>

        {/* Pasting the group is the realistic path: a кафедра roster lives in a
            spreadsheet or a Word table, and adding 30 students one at a time is
            what made "share the link with students" feel impossible. */}
        {bulkOpen && (
          <div className="mb-4 bg-surface-warm border border-border rounded-lg px-3 py-3">
            <label className="block text-[11px] font-sans text-ink-secondary mb-1">
              По одному студенту в строке — вставьте список из таблицы
            </label>
            <textarea
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              rows={6}
              placeholder={'Иванов И.И.\nПетрова А.С.\nСидоров П.'}
              className="w-full text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5 outline-none focus:border-border-strong resize-y"
            />
            <div className="flex items-center gap-2 mt-2">
              <Button
                onClick={() => bulkMut.mutate()}
                loading={bulkMut.isPending}
                disabled={bulk.split('\n').filter((l) => l.trim()).length === 0}
              >
                Добавить {bulk.split('\n').filter((l) => l.trim()).length || ''} студентов
              </Button>
              <Button variant="secondary" onClick={() => { setBulkOpen(false); setBulk('') }}>Отмена</Button>
            </div>
          </div>
        )}

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
                {inv.status === 'submitted' ? (
                  <button onClick={() => navigate(`/published/${id}/submissions/${inv.id}`)}
                    className="text-xs font-sans font-medium text-amber hover:opacity-80 transition-opacity flex-shrink-0">
                    Открыть работу →
                  </button>
                ) : (
                  <>
                    <button onClick={() => copyLink(inv.token)}
                      className="text-xs font-sans text-amber hover:opacity-80 transition-opacity flex-shrink-0">
                      Скопировать ссылку
                    </button>
                    <button onClick={() => { if (confirm('Удалить студента?')) delMut.mutate(inv.id) }}
                      aria-label="Удалить" title="Удалить"
                      className="text-ink-tertiary hover:text-danger transition-colors text-base leading-none flex-shrink-0">×</button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// <input type="datetime-local"> speaks local wall-clock time with no zone;
// the API stores an ISO instant. These two convert between them explicitly
// rather than slicing the ISO string, which would show a Moscow teacher the
// UTC hour and quietly move every deadline by three hours.
function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function fromLocalInput(value: string): string | null {
  if (!value) return null
  const d = new Date(value)   // parsed as local time, which is what was typed
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

const LockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
)
const UnlockIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" />
  </svg>
)
