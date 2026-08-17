import { useQuery } from '@tanstack/react-query'
import { getAdminErrors } from '../../api/admin'

export default function AdminErrors() {
  const { data: errors = [] } = useQuery({ queryKey: ['admin-errors'], queryFn: () => getAdminErrors(7) })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6">
        <h1 className="font-display text-2xl font-bold text-ink mb-1">Ошибки</h1>
        <p className="text-xs font-sans text-ink-tertiary mb-5">Неуспешные вызовы модели за последние 7 дней</p>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-xs font-sans">
            <thead><tr className="border-b border-border bg-surface-warm">
              <th className="text-left px-3 py-2 text-ink-secondary font-medium">Функция</th>
              <th className="text-left px-3 py-2 text-ink-secondary font-medium">Код ошибки</th>
              <th className="text-right px-3 py-2 text-ink-secondary font-medium">Кол-во</th>
              <th className="text-right px-3 py-2 text-ink-secondary font-medium">Последняя</th>
            </tr></thead>
            <tbody>
              {errors.map((e, i) => (
                <tr key={i} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 text-ink">{e.feature}</td>
                  <td className="px-3 py-2 font-mono text-danger">{e.error_code ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-ink font-medium">{e.count}</td>
                  <td className="px-3 py-2 text-right text-ink-tertiary">
                    {new Date(e.last_seen).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </td>
                </tr>
              ))}
              {errors.length === 0 && (
                <tr><td colSpan={4} className="px-3 py-8 text-center text-ink-tertiary">Ошибок нет 🎉</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
