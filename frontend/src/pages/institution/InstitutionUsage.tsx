import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getInstitutionUsage } from '../../api/institution'
import { downloadCsv } from '../../api/download'
import { useUIStore } from '../../store/uiStore'

export default function InstitutionUsage() {
  const [days, setDays] = useState(30)
  const addToast = useUIStore((s) => s.addToast)
  const { data: usage = [], isLoading } = useQuery({
    queryKey: ['inst-usage', days],
    queryFn: () => getInstitutionUsage(days),
  })

  async function exportCsv() {
    try { await downloadCsv('/api/institution/usage/export', { days }) }
    catch { addToast('Не удалось скачать отчёт', 'error') }
  }

  const totals = usage.reduce(
    (acc, u) => ({
      tokens: acc.tokens + u.total_tokens,
      grades: acc.grades + u.grade_count,
      pres:   acc.pres   + u.presentation_count,
    }),
    { tokens: 0, grades: 0, pres: 0 }
  )

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Использование</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">Активность преподавателей в единицах</p>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-2"
            >
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
            <button
              onClick={exportCsv}
              className="text-sm font-sans px-3 py-2 rounded-md border border-border-mid text-ink-secondary hover:bg-surface-warm transition-colors"
            >
              ↓ CSV
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-xs font-sans text-ink-secondary mb-2">Проверок</div>
            <div className="font-display text-2xl font-bold text-ink">{totals.grades}</div>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-xs font-sans text-ink-secondary mb-2">Презентаций</div>
            <div className="font-display text-2xl font-bold text-ink">{totals.pres}</div>
          </div>
          <div className="bg-surface border border-border rounded-lg p-4">
            <div className="text-xs font-sans text-ink-secondary mb-2">Токенов</div>
            <div className="font-display text-2xl font-bold text-ink">{totals.tokens.toLocaleString('ru-RU')}</div>
          </div>
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                <th className="text-left px-4 py-2 font-medium">Дата</th>
                <th className="text-right px-4 py-2 font-medium">Проверок</th>
                <th className="text-right px-4 py-2 font-medium">Презентаций</th>
                <th className="text-right px-4 py-2 font-medium">Токенов</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-tertiary text-xs">Загрузка…</td></tr>
              ) : usage.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-6 text-center text-ink-tertiary text-xs">Нет данных за период.</td></tr>
              ) : (
                usage.map((u) => (
                  <tr key={u.date} className="border-b border-border last:border-0">
                    <td className="px-4 py-2 text-ink">{new Date(u.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</td>
                    <td className="px-4 py-2 text-right text-ink">{u.grade_count}</td>
                    <td className="px-4 py-2 text-right text-ink">{u.presentation_count}</td>
                    <td className="px-4 py-2 text-right text-ink-secondary">{u.total_tokens.toLocaleString('ru-RU')}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
