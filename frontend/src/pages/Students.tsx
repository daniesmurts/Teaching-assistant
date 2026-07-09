import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Select from '../components/ui/Select'
import Badge from '../components/ui/Badge'
import AssignmentDetailModal from '../components/grading/AssignmentDetailModal'
import { gradeColor } from '../lib/grades'
import { buildChains, computeStudentStats, formatHours } from '../lib/studentStats'
import { getStudents, getGradingHistory, type StudentSummary } from '../api/grading'
import { getCourses } from '../api/courses'
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
          <p className="text-[10px] font-sans text-ink-tertiary mt-2">По замечаниям из отзыва, проверенным ИИ при повторной сдаче ({totalChecks} зам.)</p>
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

// ─── Students list ─────────────────────────────────────────────────────────────

export default function Students() {
  const [courseId, setCourseId] = useState('')
  const [selected, setSelected] = useState<StudentSummary | null>(null)

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

              {students.length === 0 ? (
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
