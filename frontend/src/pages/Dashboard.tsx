import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import { useAuthStore } from '../store/authStore'
import { getGradingHistory } from '../api/grading'
import { getCourses } from '../api/courses'
import Badge from '../components/ui/Badge'
import type { AssignmentStatus } from '../types'

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2">{label}</div>
      <div className="font-display text-3xl font-bold text-ink leading-none">{value}</div>
      {sub && <div className="text-xs font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

export default function Dashboard() {
  const teacher = useAuthStore((s) => s.teacher)

  const { data: history } = useQuery({
    queryKey: ['history'],
    queryFn: () => getGradingHistory({ limit: 5 }),
  })
  const { data: courses } = useQuery({
    queryKey: ['courses'],
    queryFn: getCourses,
  })

  const pending   = history?.assignments.filter((a) => a.status === 'pending').length  ?? 0
  const approved  = history?.assignments.filter((a) => a.status === 'approved').length ?? 0
  const total     = history?.total ?? 0

  const greeting = teacher?.name ? `Good day, ${teacher.name.split(' ')[0]}` : 'Good day'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Dashboard" />
      <div className="flex-1 p-6 max-w-4xl w-full mx-auto">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink tracking-tight">{greeting}</h1>
          {pending > 0 && (
            <p className="font-sans text-sm text-ink-secondary mt-1">
              {pending} assignment{pending !== 1 ? 's' : ''} pending review
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-4 mb-8">
          <StatCard label="Total graded" value={total} />
          <StatCard label="Pending review" value={pending} />
          <StatCard label="Courses" value={courses?.length ?? 0} />
        </div>

        {history && history.assignments.length > 0 && (
          <div>
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
              Recent submissions
            </div>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              {history.assignments.map((a, i) => (
                <div
                  key={a.id}
                  className={`flex items-center gap-4 px-4 py-3 ${
                    i < history.assignments.length - 1 ? 'border-b border-border' : ''
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-sans text-ink truncate">
                      {a.student_name ?? 'Anonymous student'}
                    </div>
                    <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                      {new Date(a.created_at).toLocaleDateString('ru-RU')}
                    </div>
                  </div>
                  {a.ai_grade && (
                    <div
                      className="font-display text-xl font-bold"
                      style={{ color: gradeColor(a.approved_grade ?? a.ai_grade) }}
                    >
                      {a.approved_grade ?? a.ai_grade}
                    </div>
                  )}
                  <Badge variant={a.status as AssignmentStatus}>{a.status}</Badge>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function gradeColor(grade: string): string {
  return (
    { A: 'var(--color-success)', B: 'var(--color-amber)', C: 'var(--color-warning)', D: 'var(--color-danger)', F: 'var(--color-danger)' }[grade] ??
    'var(--color-ink)'
  )
}
