import { useState, FormEvent } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import { useUIStore } from '../../store/uiStore'
import {
  getInstitutionTeachers, setTeacherActive,
  getPendingInvites, inviteTeacher, inviteTeachersBulk, revokeInvite,
} from '../../api/institution'

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

export default function InstitutionTeachers() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const [email, setEmail] = useState('')
  const [bulkMode, setBulkMode] = useState(false)
  const [bulkText, setBulkText] = useState('')

  const { data: teachers = [] } = useQuery({ queryKey: ['inst-teachers'], queryFn: getInstitutionTeachers })
  const { data: invites  = [] } = useQuery({ queryKey: ['inst-invites'],  queryFn: getPendingInvites })

  const activeMut = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => setTeacherActive(id, isActive),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inst-teachers'] }),
    onError:   () => addToast('Не удалось обновить статус', 'error'),
  })

  const inviteMut = useMutation({
    mutationFn: () => inviteTeacher(email.trim()),
    onSuccess: () => {
      setEmail('')
      qc.invalidateQueries({ queryKey: ['inst-invites'] })
      addToast('Приглашение отправлено', 'success')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Не удалось отправить приглашение'
      addToast(msg, 'error')
    },
  })

  const bulkMut = useMutation({
    mutationFn: () => {
      const emails = bulkText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      return inviteTeachersBulk(emails)
    },
    onSuccess: (res) => {
      setBulkText('')
      qc.invalidateQueries({ queryKey: ['inst-invites'] })
      const skippedNote = res.skipped.length ? `, пропущено ${res.skipped.length}` : ''
      addToast(`Отправлено приглашений: ${res.invited}${skippedNote}`, res.invited > 0 ? 'success' : 'info')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error ?? 'Не удалось отправить приглашения'
      addToast(msg, 'error')
    },
  })

  const revokeMut = useMutation({
    mutationFn: (id: string) => revokeInvite(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inst-invites'] }); addToast('Приглашение отозвано', 'info') },
    onError:   () => addToast('Не удалось отозвать приглашение', 'error'),
  })

  function handleInvite(e: FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    inviteMut.mutate()
  }

  const bulkCount = bulkText.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean).length

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-6">Преподаватели</h1>

        {/* Invite form */}
        <div className="bg-surface border border-border rounded-lg p-5 mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
              Пригласить {bulkMode ? 'преподавателей' : 'преподавателя'}
            </div>
            <button
              onClick={() => setBulkMode((v) => !v)}
              className="text-xs font-sans text-amber hover:underline"
            >
              {bulkMode ? '← Один по адресу' : 'Пригласить нескольких →'}
            </button>
          </div>

          {bulkMode ? (
            <>
              <textarea
                value={bulkText}
                onChange={(e) => setBulkText(e.target.value)}
                rows={5}
                placeholder={'Вставьте адреса — по одному на строку или через запятую:\nivanov@university.ru\npetrov@university.ru'}
                className="w-full px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong resize-none"
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs font-sans text-ink-tertiary">
                  {bulkCount > 0 ? `Адресов: ${bulkCount}` : 'Можно вставить список из таблицы'}
                </span>
                <Button onClick={() => bulkMut.mutate()} loading={bulkMut.isPending} disabled={bulkCount === 0}>
                  Отправить приглашения
                </Button>
              </div>
            </>
          ) : (
            <form onSubmit={handleInvite} className="flex gap-2">
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teacher@university.ru"
                className="flex-1 px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
              />
              <Button type="submit" loading={inviteMut.isPending}>Отправить</Button>
            </form>
          )}
          <p className="text-xs font-sans text-ink-tertiary mt-2">
            На каждый адрес придёт ссылка-приглашение (действует 7 дней). Преподаватель присоединится к вашей организации и получит полный доступ.
          </p>
        </div>

        {/* Pending invites */}
        {invites.length > 0 && (
          <div className="mb-6">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Ожидают принятия ({invites.length})
            </div>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              {invites.map((inv, i, arr) => (
                <div key={inv.id} className={`flex items-center gap-3 px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-sans text-ink truncate">{inv.email}</div>
                    <div className="text-xs font-sans text-ink-tertiary">приглашён · до {fmt(inv.expires_at)}</div>
                  </div>
                  <button
                    onClick={() => revokeMut.mutate(inv.id)}
                    className="text-xs font-sans text-ink-secondary hover:text-danger transition-colors"
                  >
                    Отозвать
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Team */}
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
          В организации ({teachers.length})
        </div>
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          {teachers.length === 0 ? (
            <p className="text-sm font-sans text-ink-secondary text-center py-8">Пока только вы. Пригласите коллег выше.</p>
          ) : (
            teachers.map((t, i, arr) => (
              <div key={t.id} className={`flex items-center gap-3 px-4 py-3 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-sans text-ink truncate">
                    {t.name ?? t.email}
                    {t.role === 'institution_admin' && (
                      <span className="ml-2 text-[10px] font-medium bg-amber-light text-amber px-1.5 py-0.5 rounded-sm">админ</span>
                    )}
                  </div>
                  <div className="text-xs font-sans text-ink-tertiary truncate">{t.email} · {t.grades} проверок</div>
                </div>
                {t.is_active ? (
                  <button
                    onClick={() => activeMut.mutate({ id: t.id, isActive: false })}
                    className="text-xs font-sans text-ink-secondary hover:text-danger transition-colors"
                  >
                    Деактивировать
                  </button>
                ) : (
                  <span className="text-xs font-sans text-ink-tertiary mr-2">неактивен</span>
                )}
                {!t.is_active && (
                  <button
                    onClick={() => activeMut.mutate({ id: t.id, isActive: true })}
                    className="text-xs font-sans text-amber hover:underline"
                  >
                    Активировать
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
