import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Select from '../components/ui/Select'
import Badge from '../components/ui/Badge'
import AssignmentDetailModal from '../components/grading/AssignmentDetailModal'
import { gradeColor } from '../lib/grades'
import { getStudents, getGradingHistory, type StudentSummary } from '../api/grading'
import { getCourses } from '../api/courses'
import type { Assignment, AssignmentStatus } from '../types'

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

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
  const assignments = (data?.assignments ?? []).slice().reverse() // chronological for the chart

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

      {/* Grade-over-time chart */}
      {assignments.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-5 mb-6">
          <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-4">Динамика оценок</div>
          <div className="flex gap-2 h-32 border-b border-border-mid pb-1">
            {assignments.map((a) => {
              const score = a.approved_score ?? a.ai_score ?? 0
              const grade = a.approved_grade ?? a.ai_grade
              return (
                <div key={a.id} className="flex-1 flex flex-col items-center justify-end group relative" title={`${fmt(a.created_at)} — ${grade ?? '?'} (${score})`}>
                  <span className="text-[10px] font-display font-bold mb-1" style={{ color: gradeColor(grade) }}>{grade}</span>
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

      {/* Assignment list */}
      <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">Работы</div>
      <div className="bg-surface border border-border rounded-lg overflow-hidden">
        {(data?.assignments ?? []).map((a, i, arr) => (
          <button
            key={a.id}
            onClick={() => setOpenAssignment(a)}
            className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors ${i < arr.length - 1 ? 'border-b border-border' : ''}`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-sans text-ink">{fmt(a.created_at)}</div>
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
        ))}
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
