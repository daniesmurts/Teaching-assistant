import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDailyUsage, getUsageByFeature, getUsageByModel, getUsageByTeacher } from '../../api/admin'

type Tab = 'day' | 'feature' | 'model' | 'teacher'

const FEATURE_LABEL: Record<string, string> = {
  grading:        'Проверка',
  presentation:   'Презентации',
  feedback_email: 'Письма',
  embedding:      'Эмбеддинги',
}

const PROVIDER_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  yandex:   'Yandex',
  qwen:     'Qwen',
  gigachat: 'GigaChat',
}

export default function AdminUsage() {
  const [tab, setTab]   = useState<Tab>('day')
  const [days, setDays] = useState(30)

  const { data: daily = [] }   = useQuery({ queryKey: ['admin-daily', days],   queryFn: () => getDailyUsage(days) })
  const { data: feature = [] } = useQuery({ queryKey: ['admin-feature', days], queryFn: () => getUsageByFeature(days) })
  const { data: model = [] }   = useQuery({ queryKey: ['admin-model', days],   queryFn: () => getUsageByModel(days) })
  const { data: teacher = [] } = useQuery({ queryKey: ['admin-teachers-usage'], queryFn: getUsageByTeacher })

  const mtdCost = daily.reduce((s, d) => s + Number(d.cost_usd), 0)

  const tabClass = (t: Tab) =>
    `px-3 py-1.5 text-sm font-sans font-medium rounded-md whitespace-nowrap transition-colors ${
      tab === t ? 'bg-amber text-white' : 'text-ink-secondary hover:bg-surface-warm'
    }`

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Использование</h1>
          <div className="text-right">
            <div className="text-sm font-sans text-ink-tertiary">Расходы за период</div>
            <div className="font-display text-2xl font-bold text-amber">${mtdCost.toFixed(4)}</div>
          </div>
        </div>

        {/* Tabs + range */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            <button className={tabClass('day')}     onClick={() => setTab('day')}>По дням</button>
            <button className={tabClass('feature')} onClick={() => setTab('feature')}>По функциям</button>
            <button className={tabClass('model')}   onClick={() => setTab('model')}>По моделям</button>
            <button className={tabClass('teacher')} onClick={() => setTab('teacher')}>По преподавателям</button>
          </div>
          {tab !== 'teacher' && (
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
            >
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm font-sans">
            {tab === 'day' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Дата</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Презентаций</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {daily.map((r) => (
                    <tr key={r.date} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.grade_count}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.presentation_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {daily.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}

            {tab === 'feature' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Функция</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Вызовов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Ср. токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Всего токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {feature.map((r) => (
                    <tr key={r.feature} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.call_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.avg_tokens_per_call.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {feature.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}

            {tab === 'model' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Провайдер</th>
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Модель</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Вызовов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Ошибок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {model.map((r) => (
                    <tr key={`${r.provider}:${r.model}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{PROVIDER_LABEL[r.provider] ?? r.provider}</td>
                      <td className="px-3 py-2 text-ink-secondary">{r.model}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.call_count}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.error_count > 0 ? r.error_count : '—'}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {model.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}

            {tab === 'teacher' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Преподаватель</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {teacher.map((r) => (
                    <tr key={r.teacher_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <div className="text-ink font-medium">{r.teacher_name ?? r.email}</div>
                        <div className="text-ink-tertiary">{r.email}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-ink">{r.grade_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {teacher.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}
          </table>
        </div>
      </div>
    </div>
  )
}
