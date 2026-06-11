import { useState, useEffect } from 'react'
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import Badge from '../components/ui/Badge'
import AssignmentDetailModal from '../components/grading/AssignmentDetailModal'
import { getGradingHistory } from '../api/grading'
import { getCourses } from '../api/courses'
import { downloadCsv } from '../api/download'
import { gradeColor } from '../lib/grades'
import { useUIStore } from '../store/uiStore'
import type { Assignment, AssignmentStatus } from '../types'

const PAGE_SIZE = 20

const fmt = (d: string) => new Date(d).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '',         label: 'Все' },
  { value: 'pending',  label: 'На проверке' },
  { value: 'approved', label: 'Подтверждённые' },
  { value: 'sent',     label: 'Отправленные' },
]

export default function History() {
  const [courseId, setCourseId]       = useState('')
  const [status, setStatus]           = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch]           = useState('')
  const [page, setPage]               = useState(1)
  const [open, setOpen]               = useState<Assignment | null>(null)

  // Debounce the search box; reset to page 1 on any filter change
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 350)
    return () => clearTimeout(t)
  }, [searchInput])
  useEffect(() => { setPage(1) }, [search, courseId, status])

  const { data: courses = [] } = useQuery({ queryKey: ['courses'], queryFn: getCourses })

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['history', courseId, status, search, page],
    queryFn: () => getGradingHistory({
      course_id: courseId || undefined,
      status:    status   || undefined,
      search:    search   || undefined,
      page,
      limit:     PAGE_SIZE,
    }),
    placeholderData: keepPreviousData,
  })

  const addToast = useUIStore((s) => s.addToast)
  async function exportCsv() {
    try { await downloadCsv('/api/grading/export', { course_id: courseId || undefined }) }
    catch { addToast('Не удалось скачать CSV', 'error') }
  }

  const assignments = data?.assignments ?? []
  const total       = data?.total ?? 0
  const totalPages  = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const selectClass = 'text-sm font-sans bg-surface border border-border rounded-md px-3 py-2 focus:outline-none focus:border-border-strong'

  return (
    <div className="flex-1 flex flex-col">
      <TopBar
        title="Журнал проверок"
        subtitle={total > 0 ? `${total} ${total === 1 ? 'запись' : total < 5 ? 'записи' : 'записей'}` : undefined}
        actions={
          <button
            onClick={exportCsv}
            className="text-xs font-sans px-3 py-1.5 rounded-md border border-border-mid text-ink-secondary hover:bg-surface-warm transition-colors"
            title="Экспорт оценок в CSV (совместимо с Moodle)"
          >
            ↓ Экспорт CSV
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6">
          <FeatureIntro
            id="history"
            title="Журнал — все проверенные работы в одном месте"
            description="Здесь хранятся все проверки и рецензии. Найдите нужную работу по имени студента, группе или предмету и откройте её, чтобы снова увидеть оценку, отзыв и полный разбор."
            steps={[
              'Используйте поиск по имени студента или группе, либо фильтры по предмету и статусу.',
              'Нажмите на работу, чтобы открыть полную оценку с обратной связью.',
              'Для объёмных работ (ВКР) внутри доступен разбор по разделам и вопросы к защите.',
            ]}
          />

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2 mb-4">
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Поиск по студенту или группе…"
              className={`${selectClass} flex-1 min-w-[180px]`}
            />
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={selectClass}>
              <option value="">Все предметы</option>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          {/* Status tabs */}
          <div className="flex gap-1 mb-4 border-b border-border">
            {STATUS_TABS.map((t) => (
              <button
                key={t.value}
                onClick={() => setStatus(t.value)}
                className={`px-3 py-2 text-xs font-sans font-medium border-b-2 -mb-px transition-colors ${
                  status === t.value ? 'border-amber text-amber' : 'border-transparent text-ink-secondary hover:text-ink'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* List */}
          {isLoading ? (
            <div className="text-sm font-sans text-ink-tertiary py-12 text-center">Загрузка…</div>
          ) : assignments.length === 0 ? (
            <div className="text-center py-16">
              <div className="font-display text-4xl text-ink-tertiary mb-3">✦</div>
              <p className="font-sans text-sm text-ink-secondary mb-1">
                {search || courseId || status ? 'Ничего не найдено по этим фильтрам.' : 'Проверенных работ пока нет.'}
              </p>
              {!(search || courseId || status) && (
                <p className="font-sans text-xs text-ink-tertiary">Проверьте первую работу — она появится здесь.</p>
              )}
            </div>
          ) : (
            <div className={`bg-surface border border-border rounded-lg overflow-hidden transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
              {assignments.map((a, i) => (
                <button
                  key={a.id}
                  onClick={() => setOpen(a)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-surface-warm transition-colors ${i < assignments.length - 1 ? 'border-b border-border' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-sans text-ink truncate">
                      {a.student_name ?? 'Без имени'}
                      {a.student_group && <span className="text-ink-tertiary font-normal"> · {a.student_group}</span>}
                    </div>
                    <div className="text-xs font-sans text-ink-tertiary truncate mt-0.5">
                      {fmt(a.created_at)} · {a.submission_text.slice(0, 60)}…
                    </div>
                  </div>
                  {(a.approved_grade ?? a.ai_grade) && (
                    <div className="font-display text-xl font-bold w-6 text-center flex-shrink-0" style={{ color: gradeColor(a.approved_grade ?? a.ai_grade) }}>
                      {a.approved_grade ?? a.ai_grade}
                    </div>
                  )}
                  <Badge variant={a.status as AssignmentStatus} />
                  <span className="text-ink-tertiary text-xs flex-shrink-0">→</span>
                </button>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="text-xs font-sans text-ink-secondary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                ← Назад
              </button>
              <span className="text-xs font-sans text-ink-tertiary">Стр. {page} из {totalPages}</span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="text-xs font-sans text-ink-secondary hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Вперёд →
              </button>
            </div>
          )}
        </div>
      </div>

      {open && <AssignmentDetailModal assignment={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
