import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getLeadershipUnits, getLeadershipOverview, type LeadershipProgramUnitState } from '../api/leadership'

// Mirrors TYPE_LABEL in InstitutionStructure — duplicated to avoid a
// cross-page import. Keep in sync when adding org-unit types.
const TYPE_LABEL: Record<string, string> = {
  institution:       'Организация',
  governance:        'Руководство',
  admin_office:      'Управление / центр',
  cluster:           'Полигруппа',
  division:          'Институт / факультет',
  ugsn:              'УГСН',
  program_direction: 'Направление подготовки',
  program:           'Образовательная программа',
  department:        'Кафедра',
}
const ROLE_LABEL: Record<string, string> = {
  view:  'Наблюдатель',
  edit:  'Редактор',
  admin: 'Администратор',
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs font-sans font-medium text-ink-secondary mb-2">{label}</div>
      <div className="font-display text-3xl font-bold leading-none text-ink">{value}</div>
      {sub && <div className="text-xs font-sans text-ink-tertiary mt-1">{sub}</div>}
    </div>
  )
}

function relativeDate(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (days === 0) return 'сегодня'
  if (days === 1) return 'вчера'
  if (days < 7)   return `${days} дн. назад`
  if (days < 30)  return `${Math.floor(days / 7)} нед. назад`
  return date.toLocaleDateString('ru-RU')
}

export default function Leadership() {
  const navigate = useNavigate()
  const { data: units = [], isLoading: unitsLoading } = useQuery({
    queryKey: ['leadership-units'],
    queryFn:  getLeadershipUnits,
  })

  // Auto-pick the first unit; persist the user's choice so revisits land on the
  // same subtree (the most common pattern for a kafedra head is one unit anyway).
  const STORAGE_KEY = 'ga_leadership_unit_v1'
  const [unitId, setUnitId] = useState<string | null>(null)
  useEffect(() => {
    if (units.length === 0) return
    const saved = (() => { try { return localStorage.getItem(STORAGE_KEY) } catch { return null } })()
    const pick = saved && units.some((u) => u.id === saved) ? saved : units[0].id
    setUnitId(pick)
  }, [units])
  useEffect(() => {
    if (unitId) { try { localStorage.setItem(STORAGE_KEY, unitId) } catch { /* quota */ } }
  }, [unitId])

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['leadership-overview', unitId],
    queryFn:  () => getLeadershipOverview(unitId!),
    enabled:  !!unitId,
  })

  const maxGrades = Math.max(1, ...(overview?.activity.grades_by_day.map((d) => d.count) ?? [0]))

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <div className="mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Сводка</h1>
          <p className="text-sm font-sans text-ink-secondary mt-1">
            Сводка по подразделениям, которыми вы руководите — преподаватели и активность за 30 дней.
          </p>
        </div>

        {unitsLoading ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">Загрузка…</div>
        ) : units.length === 0 ? (
          <div className="text-center py-12 text-sm font-sans text-ink-secondary">
            У вас нет ролей руководителя или администратора подразделения.
          </div>
        ) : (
          <>
            {/* Unit picker — single unit shown as a chip; multiple shown as a select. */}
            {units.length === 1 ? (
              <div className="mb-6 flex items-center gap-2">
                <span className="text-[10px] font-sans font-semibold uppercase tracking-wider text-ink-tertiary bg-surface-warm border border-border rounded-sm px-1.5 py-0.5">
                  {TYPE_LABEL[units[0].type_code] ?? units[0].type_code}
                </span>
                <span className="text-sm font-sans font-medium text-ink">{units[0].name}</span>
                {units[0].short_name && <span className="text-xs font-sans text-ink-tertiary">({units[0].short_name})</span>}
                <span className="text-xs font-sans text-amber bg-amber-light border border-amber/20 rounded-sm px-1.5 py-0.5 ml-2">
                  {ROLE_LABEL[units[0].role] ?? units[0].role}
                </span>
              </div>
            ) : (
              <label className="block mb-6">
                <span className="text-[11px] font-sans text-ink-secondary block mb-1">Подразделение</span>
                <select
                  value={unitId ?? ''}
                  onChange={(e) => setUnitId(e.target.value)}
                  className="w-full max-w-md text-sm font-sans bg-surface border border-border rounded-md px-2.5 py-2 outline-none focus:border-border-strong"
                >
                  {units.map((u) => (
                    <option key={u.id} value={u.id}>
                      {TYPE_LABEL[u.type_code] ?? u.type_code}: {u.name}{u.short_name ? ` (${u.short_name})` : ''} — {ROLE_LABEL[u.role] ?? u.role}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {overviewLoading || !overview ? (
              <div className="text-center py-12 text-sm font-sans text-ink-secondary">Загрузка…</div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-3 mb-8">
                  <StatCard label="Преподавателей в подразделении" value={overview.activity.teacher_count} />
                  <StatCard label="Проверок за 30 дней"            value={overview.activity.total_grades_30d} />
                </div>

                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                  Проверки за 30 дней
                </div>
                <div className="bg-surface border border-border rounded-lg p-5 mb-8">
                  {overview.activity.total_grades_30d === 0 ? (
                    <p className="text-sm font-sans text-ink-secondary text-center py-6">Пока нет активности.</p>
                  ) : (
                    <div className="flex gap-1 h-32">
                      {overview.activity.grades_by_day.map((d) => (
                        <div key={d.date} className="flex-1 flex flex-col items-center justify-end group relative"
                             title={`${new Date(d.date).toLocaleDateString('ru-RU')} — ${d.count} проверок`}>
                          <div className="w-full rounded-t-sm bg-amber transition-all"
                               style={{ height: `${Math.max(4, (d.count / maxGrades) * 100)}%` }} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Programme state — surfaces "what programmes am I */}
                {/* responsible for and what's their state" for polygroup / */}
                {/* institute / РОП heads. Auto-hides when the subtree has */}
                {/* no `program` units (e.g. a kafedra head). */}
                {overview.program_units.length > 0 && (
                  <>
                    <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                      Образовательные программы
                    </div>
                    <div className="space-y-2 mb-8">
                      {overview.program_units.map((pu) => (
                        <ProgramUnitCard key={pu.unit_id} state={pu} onOpen={(id) => navigate(`/programs/${id}`)} />
                      ))}
                    </div>
                  </>
                )}

                <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-3">
                  Преподаватели
                </div>
                {overview.teachers.length === 0 ? (
                  <div className="bg-surface border border-border rounded-lg p-6 text-center text-sm font-sans text-ink-secondary">
                    В подразделении пока нет преподавателей.
                  </div>
                ) : (
                  <div className="bg-surface border border-border rounded-lg overflow-hidden">
                    <table className="w-full text-sm font-sans">
                      <thead className="bg-surface-warm border-b border-border">
                        <tr className="text-left text-[11px] font-semibold text-ink-tertiary uppercase tracking-wider">
                          <th className="px-4 py-2.5">Имя</th>
                          <th className="px-4 py-2.5">Кафедра</th>
                          <th className="px-4 py-2.5 text-right">Проверок (30 дн)</th>
                          <th className="px-4 py-2.5 text-right">Последняя активность</th>
                        </tr>
                      </thead>
                      <tbody>
                        {overview.teachers.map((t) => (
                          <tr key={t.id}
                              onClick={() => navigate(`/leadership/teachers/${t.id}`)}
                              className="border-b border-border last:border-b-0 cursor-pointer hover:bg-surface-warm transition-colors">
                            <td className="px-4 py-2.5">
                              <div className="text-ink">{t.name ?? t.email}</div>
                              {t.name && <div className="text-xs text-ink-tertiary">{t.email}</div>}
                            </td>
                            <td className="px-4 py-2.5 text-ink-secondary">{t.primary_unit_name ?? '—'}</td>
                            <td className="px-4 py-2.5 text-right text-ink">{t.grades_30d}</td>
                            <td className="px-4 py-2.5 text-right text-ink-secondary">{relativeDate(t.last_active_at)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// Single row of programme-unit state. Shows the unit name + linked programme
// (if any), with a compact state summary. Clickable when a programme exists;
// otherwise renders as an inert card with a clear "not imported yet" line and
// what has to happen for it to become active.
function ProgramUnitCard({
  state,
  onOpen,
}: {
  state:  LeadershipProgramUnitState
  onOpen: (programId: string) => void
}) {
  const linked = state.program_id !== null
  const label  = state.unit_short_name ? `${state.unit_name} (${state.unit_short_name})` : state.unit_name

  // Overall status — colour + line copy chosen from the state markers.
  const status = !linked
    ? { tone: 'warning' as const, label: 'Не импортирована', hint: 'РОП или УМЦ импортирует описание ОП и учебный план в разделе «Образовательные программы».' }
    : !state.has_plan_doc
      ? { tone: 'warning' as const, label: 'Требуется учебный план', hint: 'Загрузите учебный план (PDF), чтобы извлечь дисциплины.' }
      : state.last_analysis_at
        ? { tone: 'success' as const, label: `Анализ выполнен · ${new Date(state.last_analysis_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`, hint: undefined }
        : { tone: 'info' as const,    label: 'Готова к анализу', hint: 'Дисциплины и компетенции извлечены — можно запустить анализ.' }

  const toneCls = status.tone === 'success' ? 'bg-success-bg text-success border-success/20'
                : status.tone === 'warning' ? 'bg-warning-bg text-warning border-warning/20'
                : 'bg-amber-light text-amber border-amber/20'

  const Container: React.ElementType = linked ? 'button' : 'div'
  const containerProps = linked
    ? {
        onClick: () => onOpen(state.program_id as string),
        className: 'w-full text-left bg-surface border border-border rounded-lg px-4 py-3 hover:border-border-mid hover:bg-surface-warm transition-colors',
      }
    : {
        className: 'bg-surface border border-border rounded-lg px-4 py-3',
      }

  return (
    <Container {...containerProps}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {linked ? (
            <>
              <div className="text-sm font-sans font-medium text-ink">{state.program_name}</div>
              <div className="text-xs font-sans text-ink-tertiary mt-0.5">
                {state.program_code && <span>{state.program_code} · </span>}
                {label}
              </div>
            </>
          ) : (
            <>
              <div className="text-sm font-sans font-medium text-ink">{label}</div>
              <div className="text-xs font-sans text-ink-tertiary mt-0.5">Подразделение в дереве организации</div>
            </>
          )}

          {linked && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] font-sans text-ink-tertiary">
              <span title="Описание ОП загружено">{state.has_description_doc ? '✓' : '·'} Описание ОП</span>
              <span title="Учебный план загружен">{state.has_plan_doc ? '✓' : '·'} Учебный план</span>
              <span>Дисциплины: {state.discipline_count}</span>
              <span>Компетенции: {state.competency_count}</span>
            </div>
          )}
          {status.hint && (
            <div className="text-[11px] font-sans text-ink-tertiary mt-1.5 leading-relaxed">{status.hint}</div>
          )}
        </div>

        <span className={`text-[10px] font-sans font-semibold uppercase tracking-wider ${toneCls} border rounded-sm px-2 py-1 flex-shrink-0`}>
          {status.label}
        </span>
      </div>
    </Container>
  )
}
