import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getActivationFunnel, getFeatureAdoption, getFeatureBreadth, getStalledTeachers } from '../../api/admin'
import { ARTIFACT_LABEL } from '../../lib/artifactLabels'

// Activation funnel — signup → первый предмет → первая проверка (aha) →
// первая презентация, derived entirely from existing data server-side.

type Tab = 'funnel' | 'features' | 'breadth' | 'stalled'

function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })
}

function fmtHours(h: number | null): string {
  if (h === null || h === undefined) return '—'
  if (h < 1) return '< 1 ч'
  if (h < 48) return `${Math.round(h)} ч`
  return `${(h / 24).toFixed(1)} дн`
}

function fmtDays(d: number | null): string {
  if (d === null || d === undefined) return '—'
  if (d < 1) return 'сразу'
  return `${Math.round(d)} дн`
}

function pct(part: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}

export default function AdminActivation() {
  const [tab, setTab] = useState<Tab>('funnel')
  const [weeks, setWeeks] = useState(12)

  const { data: funnel }       = useQuery({ queryKey: ['admin-activation-funnel', weeks], queryFn: () => getActivationFunnel(weeks) })
  const { data: stalled = [] }  = useQuery({ queryKey: ['admin-activation-stalled'], queryFn: () => getStalledTeachers() })
  const { data: features = [] } = useQuery({ queryKey: ['admin-activation-features'], queryFn: () => getFeatureAdoption() })
  const { data: breadth = [] }  = useQuery({ queryKey: ['admin-activation-breadth'], queryFn: getFeatureBreadth })

  const breadthTotal = breadth.reduce((sum, b) => sum + b.teachers, 0)

  const s = funnel?.summary

  const tabClass = (t: Tab) =>
    `px-4 py-2 text-sm font-sans font-medium rounded-md transition-colors ${
      tab === t ? 'bg-amber text-white' : 'text-ink-secondary hover:bg-surface-warm'
    }`

  const FUNNEL_STEPS = s ? [
    { label: 'Регистрация',        count: s.total_teachers },
    { label: 'Создан предмет',     count: s.created_course },
    { label: 'Первая проверка',    count: s.reached_first_grade },
    { label: 'Первая презентация', count: s.created_presentation },
  ] : []

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl font-bold text-ink">Активация</h1>
          {s && (
            <div className="text-right">
              <div className="text-sm font-sans text-ink-tertiary mb-0.5">Медиана до первой проверки</div>
              <div className="font-display text-3xl font-bold text-amber">{fmtHours(s.median_hours_to_grade)}</div>
            </div>
          )}
        </div>

        {/* Summary funnel bars */}
        {s && (
          <div className="bg-surface border border-border rounded-lg p-6 mb-6">
            <div className="text-base font-sans font-medium text-ink mb-5">
              Путь к первой проверке — за всё время
            </div>
            <div className="space-y-4">
              {FUNNEL_STEPS.map((step) => (
                <div key={step.label} className="flex items-center gap-4">
                  <div className="w-52 text-sm font-sans text-ink-secondary flex-shrink-0">{step.label}</div>
                  <div className="flex-1 h-7 bg-surface-warm rounded overflow-hidden">
                    <div
                      className="h-full bg-amber/70 rounded transition-all"
                      style={{ width: s.total_teachers ? `${(step.count / s.total_teachers) * 100}%` : 0 }}
                    />
                  </div>
                  <div className="w-28 text-sm font-sans text-ink text-right flex-shrink-0">
                    <span className="font-medium">{step.count}</span>
                    <span className="text-ink-tertiary ml-1">({pct(step.count, s.total_teachers)})</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-8 mt-6 pt-5 border-t border-border text-sm font-sans">
              <div><span className="text-ink-tertiary">Проверили за 24 ч:</span> <span className="font-medium text-ink">{pct(s.graded_within_24h, s.total_teachers)}</span></div>
              <div><span className="text-ink-tertiary">за 72 ч:</span> <span className="font-medium text-ink">{pct(s.graded_within_72h, s.total_teachers)}</span></div>
              <div><span className="text-ink-tertiary">за 7 дней:</span> <span className="font-medium text-ink">{pct(s.graded_within_7d, s.total_teachers)}</span></div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            <button className={tabClass('funnel')}   onClick={() => setTab('funnel')}>Когорты по неделям</button>
            <button className={tabClass('features')} onClick={() => setTab('features')}>Функции</button>
            <button className={tabClass('breadth')}  onClick={() => setTab('breadth')}>Широта использования</button>
            <button className={tabClass('stalled')} onClick={() => setTab('stalled')}>
              Застрявшие {stalled.length > 0 && <span className="ml-1.5 text-xs font-semibold bg-red-100 text-red-700 px-2 py-0.5 rounded-full">{stalled.length}</span>}
            </button>
          </div>
          {tab === 'funnel' && (
            <select
              value={weeks}
              onChange={(e) => setWeeks(Number(e.target.value))}
              className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-2"
            >
              <option value={4}>4 недели</option>
              <option value={12}>12 недель</option>
              <option value={26}>26 недель</option>
              <option value={52}>52 недели</option>
            </select>
          )}
        </div>

        <div className="bg-surface border border-border rounded-lg overflow-hidden">
          <table className="w-full text-sm font-sans">
            {tab === 'funnel' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Неделя</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Регистраций</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Создали предмет</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Первая проверка</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Активация</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Медиана до проверки</th>
                </tr></thead>
                <tbody>
                  {(funnel?.cohorts ?? []).map((c) => (
                    <tr key={c.week} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-ink">{fmtDate(c.week)}</td>
                      <td className="px-4 py-3 text-right text-ink">{c.signups}</td>
                      <td className="px-4 py-3 text-right text-ink">{c.created_course}</td>
                      <td className="px-4 py-3 text-right text-ink">{c.reached_first_grade}</td>
                      <td className="px-4 py-3 text-right font-medium text-ink">{pct(c.reached_first_grade, c.signups)}</td>
                      <td className="px-4 py-3 text-right text-ink-secondary">{fmtHours(c.median_hours_to_grade)}</td>
                    </tr>
                  ))}
                  {(funnel?.cohorts ?? []).length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-ink-tertiary">Нет регистраций за выбранный период</td></tr>
                  )}
                </tbody>
              </>
            )}
            {tab === 'features' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Функция</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Попробовали</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Вернулись</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Удержание</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Активны за 30 дн</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">В среднем раз</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Нашли через</th>
                </tr></thead>
                <tbody>
                  {features.map((f) => (
                    <tr key={f.kind} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-ink">{ARTIFACT_LABEL[f.kind] ?? f.kind}</td>
                      <td className="px-4 py-3 text-right text-ink">{f.teachers_ever}</td>
                      <td className="px-4 py-3 text-right text-ink">{f.teachers_returned}</td>
                      <td className="px-4 py-3 text-right font-medium text-ink">{pct(f.teachers_returned, f.teachers_ever)}</td>
                      <td className="px-4 py-3 text-right text-ink-secondary">{f.teachers_active}</td>
                      <td className="px-4 py-3 text-right text-ink-secondary">{f.avg_uses_per_teacher}</td>
                      <td className="px-4 py-3 text-right text-ink-secondary">{fmtDays(f.median_days_to_first)}</td>
                    </tr>
                  ))}
                  {features.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-ink-tertiary">Пока никто ничего не создал</td></tr>
                  )}
                </tbody>
              </>
            )}
            {tab === 'breadth' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Использовано функций</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Преподавателей</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Доля</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Заходили за 14 дн</th>
                  <th className="text-right px-4 py-3 text-ink-secondary font-medium">Удержание</th>
                </tr></thead>
                <tbody>
                  {breadth.map((b) => (
                    <tr key={b.features_used} className="border-b border-border last:border-0">
                      <td className="px-4 py-3 text-ink">
                        {b.features_used === 0 ? 'ни одной' : b.features_used}
                      </td>
                      <td className="px-4 py-3 text-right text-ink">{b.teachers}</td>
                      <td className="px-4 py-3 text-right text-ink-secondary">{pct(b.teachers, breadthTotal)}</td>
                      <td className="px-4 py-3 text-right text-ink-secondary">{b.still_active}</td>
                      <td className="px-4 py-3 text-right font-medium text-ink">{pct(b.still_active, b.teachers)}</td>
                    </tr>
                  ))}
                  {breadth.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-ink-tertiary">Нет данных</td></tr>
                  )}
                </tbody>
              </>
            )}
            {tab === 'stalled' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Преподаватель</th>
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Регистрация</th>
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Был(а) в системе</th>
                  <th className="text-left px-4 py-3 text-ink-secondary font-medium">Создан предмет</th>
                </tr></thead>
                <tbody>
                  {stalled.map((t) => (
                    <tr key={t.id} className="border-b border-border last:border-0">
                      <td className="px-4 py-3">
                        <div className="text-ink font-medium">{t.name || '—'}</div>
                        <div className="text-ink-tertiary text-[13px] mt-0.5">{t.email}</div>
                      </td>
                      <td className="px-4 py-3 text-ink">{fmtDate(t.created_at)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{fmtDate(t.last_seen_at)}</td>
                      <td className="px-4 py-3 text-ink-secondary">{t.first_course_at ? fmtDate(t.first_course_at) : 'нет'}</td>
                    </tr>
                  ))}
                  {stalled.length === 0 && (
                    <tr><td colSpan={4} className="px-4 py-8 text-center text-ink-tertiary">Нет застрявших пользователей</td></tr>
                  )}
                </tbody>
              </>
            )}
          </table>
        </div>

        {tab === 'stalled' && (
          <p className="text-sm font-sans text-ink-tertiary mt-4 leading-relaxed">
            «Застрявшие» — зарегистрировались более 48 часов назад, не проверили ни одной работы
            и не появлялись в системе последние 48 часов.
          </p>
        )}

        {tab === 'features' && (
          <p className="text-sm font-sans text-ink-tertiary mt-4 leading-relaxed">
            «Вернулись» — использовали функцию в два разных дня, а не два раза за один заход:
            это отличает «попробовал и забыл» от «пользуюсь». «Нашли через» — медиана от
            регистрации до первого использования: большое число означает, что функцию находят
            поздно или случайно. Аккаунты платформенных администраторов исключены.
          </p>
        )}

        {tab === 'breadth' && (
          <p className="text-sm font-sans text-ink-tertiary mt-4 leading-relaxed">
            Сколько разных функций освоил преподаватель, против того, заходил ли он в последние
            14 дней. Предметы, рубрики, критерии и загруженные файлы не считаются функциями —
            это подготовка, а не результат, иначе все прошедшие онбординг оказались бы в одной
            корзине. Если удержание растёт вместе с числом функций, значит новых преподавателей
            стоит раньше вести ко второй функции.
          </p>
        )}
      </div>
    </div>
  )
}
