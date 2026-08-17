import { useQuery } from '@tanstack/react-query'
import { getAdminOverview, getDailyUsage, getUsageByTeacher, getEditDistanceSummary } from '../../api/admin'

function StatCard({
  label, value, sub, danger,
}: { label: string; value: string | number; sub?: string; danger?: boolean }) {
  return (
    <div className={`border rounded-lg p-4 ${danger ? 'bg-danger-bg border-danger/20' : 'bg-surface border-border'}`}>
      <div className={`text-xs font-sans font-medium mb-2 ${danger ? 'text-danger' : 'text-ink-secondary'}`}>{label}</div>
      <div className={`font-display text-3xl font-bold leading-none ${danger ? 'text-danger' : 'text-ink'}`}>{value}</div>
      {sub && <div className="text-xs font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

export default function AdminOverview() {
  const { data: overview } = useQuery({ queryKey: ['admin-overview'],     queryFn: getAdminOverview })
  const { data: daily = [] } = useQuery({ queryKey: ['admin-usage-daily'], queryFn: () => getDailyUsage(30) })
  const { data: byTeacher = [] } = useQuery({ queryKey: ['admin-usage-teachers'], queryFn: getUsageByTeacher })
  const { data: editDistance } = useQuery({ queryKey: ['admin-edit-distance'], queryFn: getEditDistanceSummary })

  const monthCost = daily.reduce((s, d) => s + Number(d.cost_usd), 0)

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">

        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Панель администратора</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Только для платформенного администратора — никогда не показывать пользователям
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard label="Преподавателей"    value={overview?.totalTeachers      ?? '—'} />
          <StatCard label="Активны за неделю" value={overview?.activeThisWeek     ?? '—'} />
          <StatCard label="Проверок сегодня"  value={overview?.gradesToday        ?? '—'} />
          <StatCard
            label="Стоимость сегодня"
            value={overview ? `$${overview.todayCostUsd.toFixed(4)}` : '—'}
            sub={`В этом месяце: $${monthCost.toFixed(4)}`}
            danger={overview ? overview.todayCostUsd > 1 : false}
          />
        </div>

        {/* Edit-distance — how far teachers, in practice, edit the AI draft.
            Platform-wide quality signal complementing per-eval-run metrics. */}
        {editDistance && editDistance.n_30d > 0 && (
          <div className="mb-8">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Качество черновика (за 30 дней)
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                label="Сред. расхождение балла"
                value={editDistance.mean_score_delta_30d != null ? `${editDistance.mean_score_delta_30d}` : '—'}
                sub={`${editDistance.n_30d} утверждённых работ`}
              />
              <StatCard
                label="Прозу переписали"
                value={editDistance.pct_feedback_changed_30d != null ? `${editDistance.pct_feedback_changed_30d}%` : '—'}
                sub="доля изменённого общего отзыва"
              />
              <StatCard
                label="Сохранили сильные стороны"
                value={editDistance.mean_strengths_kept_30d != null ? `${editDistance.mean_strengths_kept_30d}%` : '—'}
                sub="в среднем по работе"
              />
              <StatCard
                label="Сохранили «что улучшить»"
                value={editDistance.mean_improvements_kept_30d != null ? `${editDistance.mean_improvements_kept_30d}%` : '—'}
                sub="в среднем по работе"
              />
            </div>
            {editDistance.mean_score_delta_90d != null && editDistance.mean_score_delta_30d != null && (
              <p className="text-[11px] font-sans text-ink-tertiary mt-2">
                За 90 дней среднее расхождение: {editDistance.mean_score_delta_90d}.{' '}
                {editDistance.mean_score_delta_30d < editDistance.mean_score_delta_90d
                  ? 'Тренд — снижение (система приближается к стилю преподавателей).'
                  : editDistance.mean_score_delta_30d > editDistance.mean_score_delta_90d
                    ? 'Тренд — рост (стоит проверить промпты или модель).'
                    : 'Стабильно.'}
              </p>
            )}
          </div>
        )}

        {/* Two columns: usage table + teacher table */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

          {/* Daily usage */}
          <div>
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Использование за 30 дней
            </div>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs font-sans">
                <thead>
                  <tr className="border-b border-border bg-surface-warm">
                    <th className="text-left px-3 py-2 text-ink-secondary font-medium">Дата</th>
                    <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
                    <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                    <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.slice(0, 14).map((row) => (
                    <tr key={row.date} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">
                        {new Date(row.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
                      </td>
                      <td className="px-3 py-2 text-right text-ink">{row.grade_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{row.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(row.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {daily.length === 0 && (
                    <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top teachers by cost */}
          <div>
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Топ по расходам
            </div>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-xs font-sans">
                <thead>
                  <tr className="border-b border-border bg-surface-warm">
                    <th className="text-left px-3 py-2 text-ink-secondary font-medium">Преподаватель</th>
                    <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
                    <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                  </tr>
                </thead>
                <tbody>
                  {byTeacher.slice(0, 10).map((row) => (
                    <tr key={row.teacher_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <div className="text-ink font-medium truncate max-w-[140px]">
                          {row.teacher_name ?? row.email}
                        </div>
                        <div className="text-ink-tertiary">{row.email}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-ink">{row.grade_count}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(row.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {byTeacher.length === 0 && (
                    <tr><td colSpan={3} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
