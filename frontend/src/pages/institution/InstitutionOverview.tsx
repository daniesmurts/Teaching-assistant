import { useQuery } from '@tanstack/react-query'
import { getInstitutionOverview, getInstitutionUsage } from '../../api/institution'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2">{label}</div>
      <div className="font-display text-3xl font-bold leading-none text-ink">{value}</div>
      {sub && <div className="text-xs font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

export default function InstitutionOverview() {
  const { data: overview } = useQuery({ queryKey: ['inst-overview'], queryFn: getInstitutionOverview })
  const { data: usage = [] } = useQuery({ queryKey: ['inst-usage', 30], queryFn: () => getInstitutionUsage(30) })

  const maxGrades = Math.max(1, ...usage.map((u) => u.grade_count))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">{overview?.institution?.name ?? 'Организация'}</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            Сводка по вашей организации · показатели только в единицах (без стоимости)
          </p>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          <StatCard label="Преподавателей"      value={overview?.totalTeachers      ?? '—'} />
          <StatCard label="Активны за месяц"     value={overview?.activeThisMonth    ?? '—'} />
          <StatCard label="Проверок всего"       value={overview?.totalGrades        ?? '—'} />
          <StatCard label="Презентаций всего"    value={overview?.totalPresentations ?? '—'} />
        </div>

        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
          Проверки за 30 дней
        </div>
        <div className="bg-surface border border-border rounded-lg p-5">
          {usage.length === 0 ? (
            <p className="text-sm font-sans text-ink-secondary text-center py-8">Пока нет активности.</p>
          ) : (
            <div className="flex items-end gap-1 h-32">
              {usage.slice().reverse().map((u) => (
                <div key={u.date} className="flex-1 flex flex-col items-center justify-end group relative"
                     title={`${new Date(u.date).toLocaleDateString('ru-RU')} — ${u.grade_count} проверок`}>
                  <div className="w-full rounded-t-sm bg-amber/80 transition-all"
                       style={{ height: `${Math.max(4, (u.grade_count / maxGrades) * 100)}%` }} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
