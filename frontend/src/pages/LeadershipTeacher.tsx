import { useNavigate, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getLeadershipTeacher } from '../api/leadership'

// «Руководство → Преподаватель» drill page (V2). Read-only view of a single
// teacher's activity scoped by the caller's tree access — reachable from the
// teacher list on Leadership.tsx. Backend enforces canActOnUnit on the
// teacher's primary_org_unit_id so a кафедра head can only see teachers in
// their кафедра, an институт head can drill any teacher in their subtree, etc.

const STATUS_LABEL: Record<string, string> = {
  pending:  'Черновик',
  approved: 'Утверждено',
  sent:     'Отправлено',
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2">{label}</div>
      <div className="font-display text-3xl font-bold leading-none text-ink">{value}</div>
      {sub && <div className="text-xs font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

function relativeDate(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days === 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7)   return `${days} дн. назад`
  if (days < 30)  return `${Math.floor(days / 7)} нед. назад`
  return new Date(iso).toLocaleDateString('ru-RU')
}

export default function LeadershipTeacher() {
  const { id = '' } = useParams()
  const navigate = useNavigate()

  const { data, isLoading, isError } = useQuery({
    queryKey: ['leadership-teacher', id],
    queryFn:  () => getLeadershipTeacher(id),
    enabled:  !!id,
  })

  const maxGrades = Math.max(1, ...(data?.activity.grades_by_day.map((d) => d.count) ?? [0]))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <button
          onClick={() => navigate('/leadership')}
          className="text-xs font-sans text-ink-secondary hover:text-amber mb-3"
        >
          ← Все преподаватели
        </button>

        {isLoading ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">Загрузка…</div>
        ) : isError || !data ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">
            Нет данных или у вас нет доступа к этому преподавателю.
          </div>
        ) : (
          <>
            <div className="mb-6">
              <h1 className="font-display text-2xl font-bold text-ink">{data.teacher.name ?? data.teacher.email}</h1>
              <p className="text-sm font-sans text-ink-secondary mt-1">
                {data.teacher.name && <>{data.teacher.email} · </>}
                {data.teacher.primary_unit_name ?? 'Кафедра не назначена'}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-8">
              <StatCard
                label="Проверок за 30 дней"
                value={String(data.activity.total_grades_30d)}
              />
              <StatCard
                label="Доля утверждений"
                value={data.activity.approval_rate_30d == null
                  ? '—'
                  : `${Math.round(data.activity.approval_rate_30d * 100)}%`}
                sub={data.activity.approval_rate_30d == null
                  ? undefined
                  : `${data.activity.approved_grades_30d} из ${data.activity.total_grades_30d}`}
              />
              <StatCard
                label="Средняя правка балла"
                value={data.activity.avg_edit_distance_30d == null
                  ? '—'
                  : String(data.activity.avg_edit_distance_30d)}
                sub={data.activity.avg_edit_distance_30d == null
                  ? undefined
                  : 'разница между ИСПУМ и утверждённой оценкой'}
              />
            </div>

            {/* Activity sparkline — same shape as the overview page */}
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Проверки за 30 дней
            </div>
            <div className="bg-surface border border-border rounded-lg p-5 mb-8">
              {data.activity.total_grades_30d === 0 ? (
                <p className="text-sm font-sans text-ink-secondary text-center py-6">Пока нет активности.</p>
              ) : (
                <div className="flex gap-1 h-32">
                  {data.activity.grades_by_day.map((d) => (
                    <div key={d.date} className="flex-1 flex flex-col items-center justify-end group relative"
                         title={`${new Date(d.date).toLocaleDateString('ru-RU')} — ${d.count} проверок`}>
                      <div className="w-full rounded-t-sm bg-amber/80 transition-all"
                           style={{ height: `${Math.max(4, (d.count / maxGrades) * 100)}%` }} />
                    </div>
                  ))}
                </div>
              )}
            </div>

            {data.active_subjects.length > 0 && (
              <>
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                  Активные предметы (30 дней)
                </div>
                <div className="bg-surface border border-border rounded-lg overflow-hidden mb-8">
                  {data.active_subjects.map((s, i, arr) => (
                    <div key={s.course_id}
                         className={`flex items-center justify-between px-4 py-2.5 ${i < arr.length - 1 ? 'border-b border-border' : ''}`}>
                      <span className="text-sm font-sans text-ink">{s.name}</span>
                      <span className="text-xs font-sans text-ink-tertiary">{s.grades_30d} проверок</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Последние проверки
            </div>
            {data.recent_grades.length === 0 ? (
              <div className="bg-surface border border-border rounded-lg p-6 text-center text-sm font-sans text-ink-secondary">
                Проверок пока нет.
              </div>
            ) : (
              <div className="bg-surface border border-border rounded-lg overflow-hidden">
                <table className="w-full text-sm font-sans">
                  <thead className="bg-surface-warm border-b border-border">
                    <tr className="text-left text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider">
                      <th className="px-4 py-2.5">Дата</th>
                      <th className="px-4 py-2.5">Предмет</th>
                      <th className="px-4 py-2.5">Студент</th>
                      <th className="px-4 py-2.5 text-right">ИСПУМ</th>
                      <th className="px-4 py-2.5 text-right">Утвержд.</th>
                      <th className="px-4 py-2.5 text-right">Статус</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recent_grades.map((g) => (
                      <tr key={g.id} className="border-b border-border last:border-b-0">
                        <td className="px-4 py-2.5 text-ink-secondary">{relativeDate(g.created_at)}</td>
                        <td className="px-4 py-2.5 text-ink">{g.course_name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-ink-secondary">{g.student_name ?? '—'}</td>
                        <td className="px-4 py-2.5 text-right text-ink-secondary">
                          {g.ai_grade ?? (g.ai_score != null ? g.ai_score : '—')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink">
                          {g.approved_grade ?? (g.approved_score != null ? g.approved_score : '—')}
                        </td>
                        <td className="px-4 py-2.5 text-right text-ink-tertiary">
                          {STATUS_LABEL[g.status] ?? g.status}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
