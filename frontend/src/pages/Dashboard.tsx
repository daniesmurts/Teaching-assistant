import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import TopBar from '../components/layout/TopBar'
import OnboardingChecklist from '../components/onboarding/OnboardingChecklist'
import WelcomeModal from '../components/onboarding/WelcomeModal'
import LearningLoopCard from '../components/dashboard/LearningLoopCard'
import AssignmentDetailModal from '../components/grading/AssignmentDetailModal'
import { gradeColor } from '../lib/grades'
import { nameForGreeting } from '../lib/teacherName'
import { useAuthStore } from '../store/authStore'
import { getGradingStats, getGradingHistory } from '../api/grading'
import { getCourses } from '../api/courses'
import Badge from '../components/ui/Badge'
import Icon from '../components/ui/Icon'
import type { Assignment, AssignmentStatus } from '../types'

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent,
}: {
  label: string
  value: string | number
  sub?: string
  accent?: boolean
}) {
  return (
    <div className={`border rounded-lg p-4 ${accent ? 'bg-amber-light border-amber/20' : 'bg-surface border-border'}`}>
      <div className={`text-xs font-sans font-medium mb-2 ${accent ? 'text-amber' : 'text-ink-secondary'}`}>
        {label}
      </div>
      <div className={`font-display text-3xl font-bold leading-none ${accent ? 'text-amber' : 'text-ink'}`}>
        {value}
      </div>
      {sub && (
        <div className={`text-xs font-sans mt-1 ${accent ? 'text-amber/70' : 'text-ink-tertiary'}`}>
          {sub}
        </div>
      )}
    </div>
  )
}

// ─── Subjects card ────────────────────────────────────────────────────────────
//
// Sibling to StatCard but list-shaped: shows the count up top (same visual
// weight as the other stat values so the row reads as one unit) and a short
// truncated list of up to 2 subject names underneath, each clickable. The
// previous version stuffed one arbitrary subject name into the `sub` slot of
// a generic StatCard, which blew out the card height on long Russian
// programme names (САПР… 6+ lines uppercase). Empty state nudges first add.

const PREVIEW_COUNT = 2

function SubjectsCard({ courses }: { courses: Array<{ id: string; name: string }> }) {
  const count    = courses.length
  const preview  = courses.slice(0, PREVIEW_COUNT)
  const overflow = count - preview.length

  if (count === 0) {
    return (
      <Link
        to="/courses"
        className="border border-dashed border-border-mid rounded-lg p-4 bg-surface hover:border-amber/50 hover:bg-amber-light/40 transition-colors flex flex-col justify-between min-h-[112px]"
      >
        <div className="text-xs font-sans font-medium text-ink-secondary">Предметы</div>
        <div className="text-sm font-sans font-medium text-amber">+ Добавить первый →</div>
      </Link>
    )
  }

  return (
    <Link
      to="/courses"
      className="group bg-surface border border-border rounded-lg p-4 hover:border-amber/40 hover:bg-amber-light/30 transition-colors flex flex-col"
    >
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2 group-hover:text-amber transition-colors">
        Предметы
      </div>
      <div className="font-display text-3xl font-bold leading-none text-ink">
        {count}
      </div>
      <div className="mt-2 space-y-0.5">
        {preview.map((c) => (
          <div
            key={c.id}
            title={c.name}
            className="text-[11px] font-sans text-ink-tertiary truncate leading-snug"
          >
            · {c.name}
          </div>
        ))}
        {overflow > 0 && (
          <div className="text-[11px] font-sans text-amber/80 group-hover:text-amber transition-colors leading-snug">
            +{overflow} ещё →
          </div>
        )}
      </div>
    </Link>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const teacher = useAuthStore((s) => s.teacher)

  const { data: stats } = useQuery({
    queryKey: ['grading-stats'],
    queryFn: getGradingStats,
  })
  const { data: recent } = useQuery({
    queryKey: ['history', { limit: 6 }],
    queryFn: () => getGradingHistory({ limit: 6 }),
  })
  const { data: courses = [] } = useQuery({
    queryKey: ['courses'],
    queryFn: getCourses,
  })

  const greetName = nameForGreeting(teacher?.name)
  const greeting  = greetName ? `Добрый день, ${greetName}` : 'Добрый день'

  const monthDelta = stats ? stats.this_month - stats.last_month : 0
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null)

  return (
    <div className="flex-1 flex flex-col">
      <WelcomeModal />
      <TopBar title="Главная" />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">

          {/* Heading */}
          <div className="mb-6">
            <h1 className="font-display text-2xl font-bold text-ink tracking-tight">{greeting}</h1>
            {stats && stats.pending > 0 && (
              <p className="font-sans text-sm text-ink-secondary mt-1">
                <Link to="/grading" className="text-amber hover:underline">
                  {stats.pending}&nbsp;
                  {stats.pending === 1 ? 'работа ожидает' : stats.pending < 5 ? 'работы ожидают' : 'работ ожидают'} проверки
                </Link>
              </p>
            )}
          </div>

          <OnboardingChecklist />

          {/* Stats grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <StatCard
              label="Проверено всего"
              value={stats?.total ?? '—'}
            />
            <StatCard
              label="В этом месяце"
              value={stats?.this_month ?? '—'}
              sub={
                stats
                  ? monthDelta === 0
                    ? `столько же, что и в прошлом`
                    : monthDelta > 0
                    ? `+${monthDelta} к прошлому месяцу`
                    : `${monthDelta} к прошлому месяцу`
                  : undefined
              }
              accent={!!stats && stats.this_month > 0}
            />
            <StatCard
              label="Средний балл"
              value={stats?.avg_score != null ? `${stats.avg_score}` : '—'}
              sub={stats?.avg_score != null ? 'из 100' : 'нет данных'}
            />
            <SubjectsCard courses={courses} />
          </div>

          {/* Learning loop — single hero card, full breakdown at /learning-loop */}
          <div className="mb-8">
            <LearningLoopCard />
          </div>

          {/* Two-column: recent grades + quick links */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-6">

            {/* Recent assignments */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
                  Последние работы
                </div>
                <Link to="/grading" className="text-xs font-sans text-amber hover:underline">
                  Все →
                </Link>
              </div>

              {recent && recent.assignments.length > 0 ? (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  {recent.assignments.map((a, i) => (
                    <button
                      key={a.id}
                      onClick={() => setOpenAssignment(a)}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors ${
                        i < recent.assignments.length - 1 ? 'border-b border-border' : ''
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-sans text-ink truncate">
                          {a.student_name ?? 'Студент (без имени)'}
                        </div>
                        <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                          {new Date(a.created_at).toLocaleDateString('ru-RU', {
                            day: 'numeric', month: 'short',
                          })}
                        </div>
                      </div>
                      {(a.approved_grade ?? a.ai_grade) && (
                        <div
                          className="font-display text-xl font-bold w-6 text-center flex-shrink-0"
                          style={{ color: gradeColor(a.approved_grade ?? a.ai_grade ?? '') }}
                        >
                          {a.approved_grade ?? a.ai_grade}
                        </div>
                      )}
                      <Badge variant={a.status as AssignmentStatus} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-lg px-4 py-8 text-center">
                  <p className="font-sans text-sm text-ink-secondary">Проверенных работ пока нет.</p>
                  <Link to="/grading" className="text-amber text-sm hover:underline mt-1 inline-block">
                    Проверить первую работу
                  </Link>
                </div>
              )}
            </div>

            {/* Quick links */}
            <div>
              <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                Быстрый доступ
              </div>
              <div className="space-y-2">
                {[
                  { to: '/grading',       icon: '✦', label: 'Проверить работу',    sub: 'Проверка по рубрике' },
                  { to: '/presentations', icon: '▤', label: 'Создать презентацию', sub: 'По теме лекции' },
                  { to: '/quizzes',       icon: null, label: 'Тест в аудитории',   sub: 'QR-сессия в реальном времени' },
                  { to: '/courses',       icon: '◫', label: 'Управление предметами', sub: `${courses.length} предмет${courses.length === 1 ? '' : courses.length < 5 ? 'а' : 'ов'}` },
                ].map((item) => (
                  <Link
                    key={item.to}
                    to={item.to}
                    className="flex items-center gap-3 px-3 py-2.5 bg-surface border border-border rounded-lg hover:border-amber/40 hover:bg-amber-light transition-colors group"
                  >
                    <span className="flex items-center justify-center w-5 text-base text-ink-tertiary group-hover:text-amber transition-colors select-none">
                      {item.icon ?? <Icon name="play-circle" className="w-4 h-4" />}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-sans font-medium text-ink group-hover:text-amber transition-colors">
                        {item.label}
                      </div>
                      <div className="text-xs font-sans text-ink-tertiary">{item.sub}</div>
                    </div>
                    <span className="text-ink-tertiary group-hover:text-amber transition-colors text-xs">→</span>
                  </Link>
                ))}
              </div>
            </div>

          </div>
        </div>
      </div>

      {openAssignment && (
        <AssignmentDetailModal assignment={openAssignment} onClose={() => setOpenAssignment(null)} />
      )}
    </div>
  )
}
