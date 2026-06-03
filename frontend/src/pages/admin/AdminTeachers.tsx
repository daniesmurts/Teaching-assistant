import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { getAdminTeachers, patchTeacher } from '../../api/admin'
import { useUIStore } from '../../store/uiStore'
import SubscriptionModal from './SubscriptionModal'

const PLANS = ['free', 'pro', 'institution']
const ROLES = ['teacher', 'institution_admin', 'platform_admin']

interface SubTeacher { id: string; name: string | null; email: string; plan_tier: string }

export default function AdminTeachers() {
  const [search, setSearch] = useState('')
  const [page, setPage]     = useState(1)
  const [subTeacher, setSubTeacher] = useState<SubTeacher | null>(null)
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data } = useQuery({
    queryKey: ['admin-teachers', page, search],
    queryFn: () => getAdminTeachers({ page, search: search || undefined }),
  })

  const patchMut = useMutation({
    mutationFn: ({ id, data }: { id: string; data: { plan_tier?: string; role?: string; is_active?: boolean } }) =>
      patchTeacher(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-teachers'] }); addToast('Сохранено', 'success') },
    onError:   () => addToast('Не удалось сохранить', 'error'),
  })

  const teachers = data?.teachers ?? []
  const total    = data?.total ?? 0
  const pages    = Math.ceil(total / 20)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-4">Преподаватели</h1>

        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1) }}
          placeholder="Поиск по имени или эл. почте…"
          className="w-full max-w-sm mb-4 px-3 py-2 text-sm font-sans bg-surface border border-border rounded-md focus:outline-none focus:border-border-strong"
        />

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs font-sans">
            <thead><tr className="border-b border-border bg-surface-warm">
              <th className="text-left px-3 py-2 text-ink-secondary font-medium">Преподаватель</th>
              <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
              <th className="text-left px-3 py-2 text-ink-secondary font-medium">Тариф</th>
              <th className="text-left px-3 py-2 text-ink-secondary font-medium">Роль</th>
              <th className="text-center px-3 py-2 text-ink-secondary font-medium">Активен</th>
              <th className="text-right px-3 py-2 text-ink-secondary font-medium">Подписка</th>
            </tr></thead>
            <tbody>
              {teachers.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <div className="text-ink font-medium">{t.name ?? '—'}</div>
                    <div className="text-ink-tertiary">{t.email}</div>
                  </td>
                  <td className="px-3 py-2 text-right text-ink">{t.grade_count}</td>
                  <td className="px-3 py-2">
                    <select
                      value={t.plan_tier}
                      onChange={(e) => patchMut.mutate({ id: t.id, data: { plan_tier: e.target.value } })}
                      className="text-xs bg-transparent border border-border rounded px-1.5 py-1"
                    >
                      {PLANS.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2">
                    <select
                      value={t.role}
                      onChange={(e) => patchMut.mutate({ id: t.id, data: { role: e.target.value } })}
                      className="text-xs bg-transparent border border-border rounded px-1.5 py-1"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => patchMut.mutate({ id: t.id, data: { is_active: !t.is_active } })}
                      className={`text-xs px-2 py-0.5 rounded-sm font-medium ${
                        t.is_active ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'
                      }`}
                    >
                      {t.is_active ? 'да' : 'нет'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => setSubTeacher({ id: t.id, name: t.name, email: t.email, plan_tier: t.plan_tier })}
                      className="text-xs text-amber hover:underline"
                    >
                      Управление
                    </button>
                  </td>
                </tr>
              ))}
              {teachers.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-tertiary">Ничего не найдено</td></tr>}
            </tbody>
          </table>
        </div>

        {pages > 1 && (
          <div className="flex items-center justify-center gap-3 mt-4 text-xs font-sans">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="px-2 py-1 disabled:opacity-40 hover:text-amber">← Назад</button>
            <span className="text-ink-secondary">{page} из {pages}</span>
            <button disabled={page >= pages} onClick={() => setPage((p) => p + 1)} className="px-2 py-1 disabled:opacity-40 hover:text-amber">Вперёд →</button>
          </div>
        )}
      </div>

      {subTeacher && (
        <SubscriptionModal teacher={subTeacher} onClose={() => setSubTeacher(null)} />
      )}
    </div>
  )
}
