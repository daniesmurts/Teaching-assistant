import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Select from '../components/ui/Select'
import Badge from '../components/ui/Badge'
import AssignmentDetailModal from '../components/grading/AssignmentDetailModal'
import { gradeColor } from '../lib/grades'
import { buildChains, computeStudentStats, formatHours } from '../lib/studentStats'
import { getStudents, getGradingHistory, getCohortAnalytics, type StudentSummary } from '../api/grading'
import { getCourses } from '../api/courses'
import { getBrsStudentLedger } from '../api/brs'
import type { Assignment, AssignmentStatus } from '../types'

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, hint, color }: { label: string; value: string; hint?: string; color?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg px-4 py-3">
      <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">{label}</div>
      <div className="font-display text-xl font-bold mt-1" style={color ? { color } : undefined}>{value}</div>
      {hint && <div className="text-[10px] font-sans text-ink-tertiary mt-0.5">{hint}</div>}
    </div>
  )
}

// ─── Per-student detail (assignments + grade-over-time) ───────────────────────

function StudentDetail({ student, courseId, onBack }: { student: StudentSummary; courseId?: string; onBack: () => void }) {
  const [openAssignment, setOpenAssignment] = useState<Assignment | null>(null)
  const { data } = useQuery({
    queryKey: ['student-history', student.student_name, student.student_group, courseId],
    queryFn: () => getGradingHistory({
      student_name:  student.student_name,
      student_group: student.student_group ?? '',
      course_id:     courseId,
      limit:         100,
    }),
  })
  const all = data?.assignments ?? []
  const assignments = all.slice().reverse() // chronological for the chart
  const stats = computeStudentStats(all)
  const chains = buildChains(all)
  const totalChecks = stats.corrections.addressed + stats.corrections.partial + stats.corrections.not_addressed

  // Feature AE — semester БРС ledger. Scheme is per-course, so this only
  // renders once a specific course is selected upstream (courseId prop).
  const { data: ledger } = useQuery({
    queryKey: ['brs-student-ledger', student.student_name, student.student_group, courseId],
    queryFn: () => getBrsStudentLedger(courseId!, student.student_name, student.student_group ?? undefined),
    enabled: Boolean(courseId),
  })

  return (
    <div>
      <button onClick={onBack} className="text-xs font-sans text-ink-secondary hover:text-amber mb-4">← Все студенты</button>

      <div className="mb-6">
        <h1 className="font-display text-2xl font-bold text-ink">{student.student_name}</h1>
        <p className="text-sm font-sans text-ink-secondary mt-1">
          {student.student_group && <span>Группа {student.student_group} · </span>}
          {student.submissions} {student.submissions === 1 ? 'работа' : 'работ'}
          {student.avg_score != null && <span> · средний балл {student.avg_score}</span>}
        </p>
      </div>

      {/* Submission / rework stats */}
      {all.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Первые сдачи" value={String(stats.firstSubmissions)} />
          <StatCard
            label="Доработки"
            value={String(stats.resubmissions)}
            hint={stats.chainsWithRework > 0 ? `${stats.chainsWithRework} из ${stats.totalChains} работ дорабатывались` : 'работы не дорабатывались'}
          />
          <StatCard
            label="Время на доработку"
            value={stats.medianReworkHours != null ? formatHours(stats.medianReworkHours) : '—'}
            hint={stats.medianReworkHours != null ? 'медиана между версиями' : undefined}
          />
          <StatCard
            label="Прогресс версий"
            value={stats.avgScoreDelta != null ? `${stats.avgScoreDelta > 0 ? '+' : ''}${stats.avgScoreDelta}` : '—'}
            hint={stats.avgScoreDelta != null ? 'ср. изменение балла' : undefined}
            color={stats.avgScoreDelta != null ? (stats.avgScoreDelta > 0 ? 'var(--color-success)' : stats.avgScoreDelta < 0 ? 'var(--color-danger)' : undefined) : undefined}
          />
        </div>
      )}

      {/* How well the student fixes what feedback pointed out (ai_revision_check) */}
      {totalChecks > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">Работа с замечаниями</div>
            {stats.correctionRate != null && (
              <div className="text-sm font-display font-bold" style={{ color: stats.correctionRate >= 70 ? 'var(--color-success)' : stats.correctionRate >= 40 ? 'var(--color-warning)' : 'var(--color-danger)' }}>
                {stats.correctionRate}% исправлено
              </div>
            )}
          </div>
          <div className="flex h-2.5 rounded-full overflow-hidden bg-surface-warm">
            {stats.corrections.addressed > 0 && (
              <div style={{ width: `${(stats.corrections.addressed / totalChecks) * 100}%`, backgroundColor: 'var(--color-success)' }} />
            )}
            {stats.corrections.partial > 0 && (
              <div style={{ width: `${(stats.corrections.partial / totalChecks) * 100}%`, backgroundColor: 'var(--color-warning)' }} />
            )}
            {stats.corrections.not_addressed > 0 && (
              <div style={{ width: `${(stats.corrections.not_addressed / totalChecks) * 100}%`, backgroundColor: 'var(--color-danger)' }} />
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-[11px] font-sans text-ink-secondary">
            <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: 'var(--color-success)' }} />исправлено {stats.corrections.addressed}</span>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: 'var(--color-warning)' }} />частично {stats.corrections.partial}</span>
            <span><span className="inline-block w-2 h-2 rounded-full mr-1" style={{ backgroundColor: 'var(--color-danger)' }} />не исправлено {stats.corrections.not_addressed}</span>
          </div>
          <p className="text-[10px] font-sans text-ink-tertiary mt-2">По замечаниям из отзыва, повторно проверенным при пересдаче ({totalChecks} зам.)</p>
        </div>
      )}

      {/* Grade-over-time chart */}
      {assignments.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5 mb-6">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-4">Динамика оценок</div>
          <div className="flex gap-2 h-32 border-b border-border-mid pb-1">
            {assignments.map((a) => {
              const score = a.approved_score ?? a.ai_score ?? 0
              const grade = a.approved_grade ?? a.ai_grade
              const isRevision = a.revision_number > 1
              return (
                <div key={a.id} className="flex-1 flex flex-col items-center justify-end group relative" title={`${fmt(a.created_at)} — ${grade ?? '?'} (${score})${isRevision ? ` · доработка №${a.revision_number - 1}` : ''}`}>
                  <span className="text-[10px] font-display font-bold mb-1" style={{ color: gradeColor(grade) }}>{grade}{isRevision && <span className="text-ink-tertiary font-sans font-normal"> ↻</span>}</span>
                  <div className="w-full max-w-[40px] rounded-t-sm transition-all" style={{ height: `${Math.max(6, score)}%`, backgroundColor: gradeColor(grade), opacity: 0.85 }} />
                </div>
              )
            })}
          </div>
          <div className="flex gap-2 mt-1">
            {assignments.map((a) => (
              <div key={a.id} className="flex-1 text-center text-[9px] text-ink-tertiary truncate">{new Date(a.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</div>
            ))}
          </div>
        </div>
      )}

      {/* БРС ledger (Feature AE) — running semester score per checkpoint */}
      {ledger && ledger.checkpoints.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5 mb-6">
          <div className="flex items-baseline justify-between mb-3">
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">БРС за семестр</div>
            <div className="text-sm font-display font-bold text-ink">
              {ledger.total_points} / {ledger.total_max_points}
              {ledger.final_grade_label && <span className="ml-2 text-success">{ledger.final_grade_label}</span>}
            </div>
          </div>
          <div className="space-y-2">
            {ledger.checkpoints.map((c) => (
              <div key={c.checkpoint_id} className="flex items-center gap-3">
                <span className="text-sm font-sans text-ink flex-1 min-w-0 truncate">{c.checkpoint_name}</span>
                <div className="w-32 h-1.5 bg-border rounded-full overflow-hidden flex-shrink-0">
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{
                      width: `${c.earned_points != null ? Math.min(100, (c.earned_points / c.max_points) * 100) : 0}%`,
                      backgroundColor: 'var(--color-amber)',
                    }}
                  />
                </div>
                <span className="text-xs font-sans text-ink-secondary w-20 text-right flex-shrink-0">
                  {c.earned_points != null ? `${Math.round(c.earned_points * 10) / 10} / ${c.max_points}` : `— / ${c.max_points}`}
                  {c.raw_points != null && c.raw_points > c.max_points && ' (сумма выше макс.)'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Assignment list — grouped into revision chains, newest activity first */}
      <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">Работы</div>
      <div className="space-y-3">
        {chains.map((chain) => {
          const reversed = chain.versions.slice().reverse() // newest version on top
          return (
            <div key={chain.root.id} className="bg-surface border border-border rounded-lg overflow-hidden">
              {reversed.map((a, i) => {
                // Score delta vs the previous version in the chain (chronologically earlier).
                const idx = chain.versions.indexOf(a)
                const prev = idx > 0 ? chain.versions[idx - 1] : null
                const score = a.approved_score ?? a.ai_score
                const prevScore = prev ? (prev.approved_score ?? prev.ai_score) : null
                const delta = score != null && prevScore != null ? score - prevScore : null
                const isRevision = idx > 0 || a.revision_number > 1
                return (
                  <button
                    key={a.id}
                    onClick={() => setOpenAssignment(a)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors ${i < reversed.length - 1 ? 'border-b border-border' : ''} ${isRevision && chain.versions.length > 1 && i > 0 ? 'pl-8' : ''}`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-sans text-ink flex items-center gap-2">
                        {fmt(a.created_at)}
                        {isRevision && (
                          <span className="text-[10px] font-sans font-medium text-ink-secondary bg-surface-warm border border-border rounded-full px-2 py-0.5">
                            версия {Math.max(a.revision_number, idx + 1)}
                          </span>
                        )}
                        {delta != null && delta !== 0 && (
                          <span className="text-[10px] font-sans font-semibold" style={{ color: delta > 0 ? 'var(--color-success)' : 'var(--color-danger)' }}>
                            {delta > 0 ? '+' : ''}{delta}
                          </span>
                        )}
                      </div>
                      <div className="text-xs font-sans text-ink-tertiary truncate">{a.submission_text.slice(0, 80)}…</div>
                    </div>
                    {(a.approved_grade ?? a.ai_grade) && (
                      <div className="font-display text-xl font-bold w-6 text-center" style={{ color: gradeColor(a.approved_grade ?? a.ai_grade) }}>
                        {a.approved_grade ?? a.ai_grade}
                      </div>
                    )}
                    <Badge variant={a.status as AssignmentStatus} />
                    <span className="text-ink-tertiary text-xs flex-shrink-0">→</span>
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>

      {openAssignment && (
        <AssignmentDetailModal assignment={openAssignment} onClose={() => setOpenAssignment(null)} />
      )}
    </div>
  )
}

// ─── Cohort analytics (Feature C) ──────────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 75) return 'var(--color-success)'
  if (score >= 55) return 'var(--color-warning)'
  return 'var(--color-danger)'
}

function CohortView({ courseId, students, onSelectStudent }: {
  courseId?: string
  students: StudentSummary[]
  onSelectStudent: (s: StudentSummary) => void
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['cohort-analytics', courseId],
    queryFn: () => getCohortAnalytics(courseId),
  })

  if (isLoading) {
    return <p className="text-sm font-sans text-ink-secondary py-8 text-center">Загрузка…</p>
  }
  if (!data || data.total_submissions === 0) {
    return (
      <div className="text-center py-12">
        <p className="font-sans text-sm text-ink-secondary mb-1">Пока недостаточно данных для аналитики по группе.</p>
        <p className="font-sans text-xs text-ink-tertiary">Появится, как только наберётся несколько проверенных работ.</p>
      </div>
    )
  }

  const totalGraded = Object.values(data.histogram).reduce((s, n) => s + n, 0)
  // Find each slipping student's roster summary (submissions/avg/last date) so
  // the click-through to their profile shows a real header, not placeholder text.
  const findRosterEntry = (name: string, group: string | null) =>
    students.find((s) => s.student_name === name && (s.student_group ?? null) === group)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Студентов" value={String(data.total_students)} />
        <StatCard label="Проверенных работ" value={String(data.total_submissions)} />
      </div>

      {/* Overall grade distribution */}
      {totalGraded > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">Распределение оценок</div>
          <div className="space-y-1.5">
            {(['5', '4', '3', '2'] as const).map((g) => {
              const count = data.histogram[g] ?? 0
              return (
                <div key={g} className="flex items-center gap-2.5">
                  <span className="font-display font-bold w-4 text-center flex-shrink-0" style={{ color: gradeColor(g) }}>{g}</span>
                  <div className="flex-1 h-3 bg-surface-warm rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${totalGraded ? (count / totalGraded) * 100 : 0}%`, backgroundColor: gradeColor(g) }} />
                  </div>
                  <span className="text-xs font-sans text-ink-secondary w-6 text-right flex-shrink-0">{count}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Per-group breakdown */}
      {data.by_group.length > 1 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider px-4 pt-4 pb-2">По группам</div>
          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                <th className="text-left px-4 py-2 font-medium">Группа</th>
                <th className="text-right px-4 py-2 font-medium">Работ</th>
                <th className="text-right px-4 py-2 font-medium">Ср. балл</th>
              </tr>
            </thead>
            <tbody>
              {data.by_group.map((g) => (
                <tr key={g.group ?? '—'} className="border-b border-border last:border-0">
                  <td className="px-4 py-2.5 text-ink">{g.group ?? 'Без группы'}</td>
                  <td className="px-4 py-2.5 text-right text-ink-secondary">{g.count}</td>
                  <td className="px-4 py-2.5 text-right text-ink">{g.avg_score ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Weakest criteria across the cohort */}
      {data.top_missed_criteria.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">Слабые места по критериям</div>
          <div className="space-y-3">
            {data.top_missed_criteria.map((c) => (
              <div key={c.name}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-sans text-ink">{c.name}</span>
                  <span className="text-xs font-sans text-ink-secondary">{c.avg_score} · {c.count} работ</span>
                </div>
                <div className="h-1.5 bg-border rounded-full overflow-hidden">
                  <div className="h-full rounded-full transition-all duration-700" style={{ width: `${c.avg_score}%`, backgroundColor: scoreColor(c.avg_score) }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Students whose recent grades dropped meaningfully */}
      {data.slipping.length > 0 && (
        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider px-4 pt-4 pb-2">Требуют внимания</div>
          <p className="text-[11px] font-sans text-ink-tertiary px-4 pb-2">Средний балл заметно снизился за последние работы</p>
          {data.slipping.map((s, i) => {
            const rosterEntry = findRosterEntry(s.student_name, s.student_group)
            return (
              <button
                key={`${s.student_name}|${s.student_group}`}
                onClick={() => rosterEntry && onSelectStudent(rosterEntry)}
                disabled={!rosterEntry}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors ${i < data.slipping.length - 1 ? 'border-b border-border' : ''}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-sans text-ink font-medium">{s.student_name}</div>
                  <div className="text-xs font-sans text-ink-tertiary">
                    {s.student_group && <span>Группа {s.student_group} · </span>}
                    было {s.prior_avg} → стало {s.recent_avg}
                  </div>
                </div>
                <span className="text-sm font-sans font-semibold" style={{ color: 'var(--color-danger)' }}>{s.delta}</span>
                {rosterEntry && <span className="text-ink-tertiary text-xs flex-shrink-0">→</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Students list ─────────────────────────────────────────────────────────────

export default function Students() {
  const [courseId, setCourseId] = useState('')
  const [selected, setSelected] = useState<StudentSummary | null>(null)
  const [view, setView] = useState<'list' | 'cohort'>('list')

  const { data: courses = [] }  = useQuery({ queryKey: ['courses'], queryFn: getCourses })
  const { data: students = [] } = useQuery({ queryKey: ['students', courseId], queryFn: () => getStudents(courseId || undefined) })

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Студенты" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 md:px-6 py-6">
          {!selected && (
            <FeatureIntro
              id="students"
              videoSlug="students"
              title="Студенты — успеваемость собирается автоматически"
              description="Здесь нет ручного ввода: список формируется сам из проверенных работ. Указывайте имя и группу студента при проверке — и система сама соберёт его профиль с историей оценок и динамикой по времени."
              steps={[
                'Проверяя работу, заполните поля «Имя студента» и «Группа».',
                'Откройте профиль студента, чтобы увидеть все его работы и график оценок.',
                'Фильтруйте по предмету, чтобы смотреть успеваемость в рамках конкретной дисциплины.',
              ]}
            />
          )}
          {selected ? (
            <StudentDetail student={selected} courseId={courseId || undefined} onBack={() => setSelected(null)} />
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 mb-4">
                <Select
                  value={courseId}
                  onChange={setCourseId}
                  ariaLabel="Фильтр по предмету"
                  className="w-full max-w-xs"
                  options={[
                    { value: '', label: 'Все предметы' },
                    ...courses.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
                <span className="text-xs font-sans text-ink-tertiary whitespace-nowrap">
                  {students.length}&nbsp;студ.
                </span>
              </div>

              <div className="flex border-b border-border mb-4">
                {([['list', 'Список'], ['cohort', 'По группе']] as const).map(([v, label]) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className={`px-3 py-2 text-xs font-sans font-medium border-b-2 transition-colors cursor-pointer ${
                      view === v ? 'border-amber text-amber' : 'border-transparent text-ink-secondary hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {view === 'cohort' ? (
                <CohortView courseId={courseId || undefined} students={students} onSelectStudent={setSelected} />
              ) : students.length === 0 ? (
                <div className="text-center py-12">
                  <p className="font-sans text-sm text-ink-secondary mb-1">Студентов пока нет.</p>
                  <p className="font-sans text-xs text-ink-tertiary">Укажите имя студента при проверке работы — он появится здесь.</p>
                </div>
              ) : (
                <div className="bg-surface border border-border rounded-lg overflow-hidden">
                  <table className="w-full text-sm font-sans">
                    <thead>
                      <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                        <th className="text-left px-4 py-2 font-medium">Студент</th>
                        <th className="text-left px-4 py-2 font-medium">Группа</th>
                        <th className="text-right px-4 py-2 font-medium">Работ</th>
                        <th className="text-right px-4 py-2 font-medium">Ср. балл</th>
                        <th className="text-right px-4 py-2 font-medium">Последняя</th>
                      </tr>
                    </thead>
                    <tbody>
                      {students.map((s) => (
                        <tr
                          key={`${s.student_name}|${s.student_group}`}
                          onClick={() => setSelected(s)}
                          className="border-b border-border last:border-0 cursor-pointer hover:bg-surface-warm transition-colors"
                        >
                          <td className="px-4 py-2.5 text-ink font-medium">{s.student_name}</td>
                          <td className="px-4 py-2.5 text-ink-secondary">{s.student_group ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-ink">{s.submissions}</td>
                          <td className="px-4 py-2.5 text-right text-ink">{s.avg_score ?? '—'}</td>
                          <td className="px-4 py-2.5 text-right text-ink-tertiary text-xs">{fmt(s.last_submission)}</td>
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
    </div>
  )
}
