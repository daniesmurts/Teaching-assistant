import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getUmcDashboard, downloadUmcDashboardXlsx } from '../../api/umcDashboard'
import { useUIStore } from '../../store/uiStore'
import SubmissionStatusBadge from '../../components/rpd/SubmissionStatusBadge'
import type { UmcReadinessRow } from '../../types'

// TODO.md Feature V — read-only readiness matrix for methodology-office
// staff (УМЦ): does a discipline have a working РПД, has it been checked
// against its claimed competencies, what did that check find. Assembled
// entirely from services/umcDashboard.ts's aggregation over signals that
// already exist (program_documents, program_document_reviews / Feature K).

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

function fmtPct(n: number | null): string {
  return n == null ? '—' : `${n}%`
}

// Same three-tier semantics as the backend's coverageStatus() in
// umcDashboardXlsx.ts (kept as a small local duplicate rather than a shared
// import — pure 4-line classification, not worth threading across the
// frontend/backend boundary): no РПД is the most urgent state, uploaded-but-
// unchecked has no verdict yet, and a checked one reads off its own score.
type Status = 'danger' | 'warning' | 'success' | 'pending'
function readinessStatus(r: UmcReadinessRow): Status {
  if (!r.has_syllabus) return 'danger'
  if (!r.reviewed) return 'pending'
  const c = r.overall_coverage ?? 0
  if (c >= 80) return 'success'
  if (c >= 50) return 'warning'
  return 'danger'
}

const STATUS_DOT: Record<Status, string> = {
  danger:  'bg-danger',
  warning: 'bg-warning',
  success: 'bg-success',
  pending: 'bg-ink-tertiary',
}
const STATUS_LABEL: Record<Status, string> = {
  danger:  'РПД не загружена или покрытие низкое',
  warning: 'Покрытие компетенций частичное',
  success: 'РПД загружена и проверена',
  pending: 'Загружена, ещё не проверена',
}

function StatusDot({ row }: { row: UmcReadinessRow }) {
  const status = readinessStatus(row)
  return <span className={`inline-block w-2 h-2 rounded-full ${STATUS_DOT[status]}`} title={STATUS_LABEL[status]} />
}

export default function UmcDashboard() {
  const addToast = useUIStore((s) => s.addToast)
  const [downloading, setDownloading] = useState(false)
  const { data, isLoading } = useQuery({
    queryKey: ['umc-dashboard'],
    queryFn: getUmcDashboard,
  })

  async function handleDownload() {
    setDownloading(true)
    try {
      await downloadUmcDashboardXlsx()
    } catch {
      addToast('Не удалось скачать отчёт', 'error')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-1">
          <div>
            <h1 className="font-display text-2xl font-bold text-ink">Готовность УМК</h1>
            <p className="text-xs font-sans text-ink-tertiary mt-1">
              Загрузка и проверка рабочих программ по всем образовательным программам
            </p>
          </div>
          <button
            onClick={handleDownload}
            disabled={downloading || !data || data.rows.length === 0}
            className="text-sm font-sans px-3 py-2 rounded-md border border-border-mid text-ink-secondary hover:bg-surface-warm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {downloading ? 'Экспортируем…' : '↓ XLSX'}
          </button>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs font-sans text-ink-tertiary">Загрузка…</div>
        ) : !data || data.rows.length === 0 ? (
          <div className="py-12 text-center">
            <p className="font-sans text-sm text-ink-secondary">
              Нет ни одной образовательной программы с добавленными дисциплинами.
            </p>
          </div>
        ) : (
          <>
            {/* ── Totals ─────────────────────────────────────────────────── */}
            <div className="grid grid-cols-4 gap-3 my-6">
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-sans text-ink-secondary mb-2">Дисциплин</div>
                <div className="font-display text-2xl font-bold text-ink">{data.totals.discipline_count}</div>
              </div>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-sans text-ink-secondary mb-2">РПД загружено</div>
                <div className="font-display text-2xl font-bold text-ink">{data.totals.syllabus_count}</div>
              </div>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-sans text-ink-secondary mb-2">Проверено</div>
                <div className="font-display text-2xl font-bold text-ink">{data.totals.reviewed_count}</div>
              </div>
              <div className="bg-surface border border-border rounded-lg p-4">
                <div className="text-xs font-sans text-ink-secondary mb-2">Среднее покрытие</div>
                <div className="font-display text-2xl font-bold text-ink">{fmtPct(data.totals.avg_coverage)}</div>
              </div>
            </div>

            {/* ── By department ──────────────────────────────────────────── */}
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
              По подразделениям
            </div>
            <div className="bg-surface border border-border rounded-lg overflow-hidden mb-6">
              <table className="w-full text-sm font-sans">
                <thead>
                  <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                    <th className="text-left px-4 py-2 font-medium">Подразделение</th>
                    <th className="text-right px-4 py-2 font-medium">Дисциплин</th>
                    <th className="text-right px-4 py-2 font-medium">РПД загружено</th>
                    <th className="text-right px-4 py-2 font-medium">Проверено</th>
                    <th className="text-right px-4 py-2 font-medium">Среднее покрытие</th>
                  </tr>
                </thead>
                <tbody>
                  {data.departments.map((d) => (
                    <tr key={d.department_org_unit_id ?? '__none__'} className="border-b border-border last:border-0">
                      <td className="px-4 py-2 text-ink">{d.department_name}</td>
                      <td className="px-4 py-2 text-right text-ink">{d.discipline_count}</td>
                      <td className="px-4 py-2 text-right text-ink">{d.syllabus_count}</td>
                      <td className="px-4 py-2 text-right text-ink">{d.reviewed_count}</td>
                      <td className="px-4 py-2 text-right text-ink-secondary">{fmtPct(d.avg_coverage)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* ── Full matrix ────────────────────────────────────────────── */}
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
              Все дисциплины
            </div>
            <div className="bg-surface border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm font-sans">
                <thead>
                  <tr className="border-b border-border bg-surface-warm text-xs text-ink-secondary">
                    <th className="text-left px-4 py-2 font-medium"></th>
                    <th className="text-left px-4 py-2 font-medium">Подразделение</th>
                    <th className="text-left px-4 py-2 font-medium">Программа</th>
                    <th className="text-left px-4 py-2 font-medium">Дисциплина</th>
                    <th className="text-right px-4 py-2 font-medium">Семестр</th>
                    <th className="text-right px-4 py-2 font-medium">Покрытие</th>
                    <th className="text-left px-4 py-2 font-medium">Согласование</th>
                    <th className="text-right px-4 py-2 font-medium">Обновлено</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.discipline_id} className="border-b border-border last:border-0">
                      <td className="px-4 py-2"><StatusDot row={r} /></td>
                      <td className="px-4 py-2 text-ink-secondary">{r.department_name ?? 'Без подразделения'}</td>
                      <td className="px-4 py-2 text-ink">
                        {r.program_name}
                        {r.program_code && <span className="text-ink-tertiary"> · {r.program_code}</span>}
                      </td>
                      <td className="px-4 py-2 text-ink">{r.discipline_name}</td>
                      <td className="px-4 py-2 text-right text-ink-secondary">{r.semester}</td>
                      <td className="px-4 py-2 text-right text-ink-secondary">
                        {r.reviewed ? fmtPct(r.overall_coverage) : (r.has_syllabus ? 'не проверено' : '—')}
                      </td>
                      <td className="px-4 py-2">
                        {r.submission_status ? <SubmissionStatusBadge status={r.submission_status} /> : (
                          <span className="text-xs font-sans text-ink-tertiary">не начато</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right text-ink-tertiary">
                        {fmtDate(r.review_created_at ?? r.syllabus_uploaded_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
