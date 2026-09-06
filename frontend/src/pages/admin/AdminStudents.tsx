import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getStudentEngagement } from '../../api/admin'

// Студенческая сторона — единственные две поверхности, где студент реально
// работает внутри ИСПУМ. Всё, что уходит файлом (тесты, задания, темы),
// платформа после выгрузки не видит: это ограничение продукта, а не метрик,
// и оно проговорено внизу страницы.
//
// Только агрегаты: ни имени, ни почты, ни строки по конкретному студенту
// сюда не приходит (Research.md §5.1.2).

function pct(part: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}

function num(v: number | null, suffix = ''): string {
  if (v === null || v === undefined) return '—'
  return `${v}${suffix}`
}

export default function AdminStudents() {
  const [days, setDays] = useState(90)
  const { data } = useQuery({ queryKey: ['admin-students', days], queryFn: () => getStudentEngagement(days) })

  const w = data?.writing
  const l = data?.live

  const STEPS = w ? [
    { label: 'Приглашено',        count: w.invited },
    { label: 'Открыли ссылку',    count: w.opened },
    { label: 'Начали писать',     count: w.started },
    { label: 'Сдали работу',      count: w.submitted },
    { label: 'Проверено',         count: w.graded },
    { label: 'Утверждено',        count: w.approved },
  ] : []

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-3xl font-bold text-ink">Студенты</h1>
          <select
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="text-sm font-sans bg-surface border border-border rounded-md px-3 py-2"
          >
            <option value={30}>30 дней</option>
            <option value={90}>90 дней</option>
            <option value={365}>Год</option>
          </select>
        </div>

        {/* Письменные работы */}
        <div className="bg-surface border border-border rounded-lg p-6 mb-6">
          <div className="flex items-baseline justify-between mb-5">
            <div className="text-base font-sans font-medium text-ink">
              Опубликованные задания — путь студента
            </div>
            <div className="text-sm font-sans text-ink-tertiary">
              заданий опубликовано: <span className="text-ink font-medium">{w?.assignments_published ?? 0}</span>
            </div>
          </div>

          <div className="space-y-4">
            {STEPS.map((step) => (
              <div key={step.label} className="flex items-center gap-4">
                <div className="w-44 text-sm font-sans text-ink-secondary flex-shrink-0">{step.label}</div>
                <div className="flex-1 h-7 bg-surface-warm rounded overflow-hidden">
                  <div
                    className="h-full bg-amber/70 rounded transition-all"
                    style={{ width: w?.invited ? `${(step.count / w.invited) * 100}%` : 0 }}
                  />
                </div>
                <div className="w-28 text-sm font-sans text-ink text-right flex-shrink-0">
                  <span className="font-medium">{step.count}</span>
                  <span className="text-ink-tertiary ml-1">({pct(step.count, w?.invited ?? 0)})</span>
                </div>
              </div>
            ))}
            {!w && <div className="text-sm font-sans text-ink-tertiary">Нет данных</div>}
          </div>

          {w && (
            <div className="grid grid-cols-4 gap-6 mt-6 pt-5 border-t border-border text-sm font-sans">
              <div>
                <div className="text-ink-tertiary mb-0.5">Времени за работой</div>
                <div className="font-medium text-ink">{num(w.median_active_minutes, ' мин')}</div>
              </div>
              <div>
                <div className="text-ink-tertiary mb-0.5">От начала до сдачи</div>
                <div className="font-medium text-ink">{num(w.median_elapsed_hours, ' ч')}</div>
              </div>
              <div>
                <div className="text-ink-tertiary mb-0.5">Правок в работе</div>
                <div className="font-medium text-ink">{num(w.median_revisions)}</div>
              </div>
              <div>
                <div className="text-ink-tertiary mb-0.5">Собрано вставкой</div>
                <div className="font-medium text-ink">{w.heavy_paste_submissions} из {w.submitted}</div>
              </div>
            </div>
          )}
        </div>

        {/* Интерактивные сессии */}
        <div className="bg-surface border border-border rounded-lg p-6 mb-6">
          <div className="text-base font-sans font-medium text-ink mb-5">
            Интерактивные сессии
          </div>
          {l ? (
            <div className="grid grid-cols-3 gap-6 text-sm font-sans">
              <div>
                <div className="text-ink-tertiary mb-0.5">Сессий проведено</div>
                <div className="font-display text-2xl font-bold text-ink">{l.sessions_run}</div>
                <div className="text-ink-tertiary mt-1">
                  доведено до конца: {l.sessions_finished}; без участников: {l.sessions_empty}
                </div>
              </div>
              <div>
                <div className="text-ink-tertiary mb-0.5">Участников</div>
                <div className="font-display text-2xl font-bold text-ink">{l.participants}</div>
                <div className="text-ink-tertiary mt-1">
                  медиана на сессию: {num(l.median_participants)}
                </div>
              </div>
              <div>
                <div className="text-ink-tertiary mb-0.5">Верных ответов</div>
                <div className="font-display text-2xl font-bold text-amber">{pct(l.correct_answers, l.answers)}</div>
                <div className="text-ink-tertiary mt-1">
                  {l.correct_answers} из {l.answers}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm font-sans text-ink-tertiary">Нет данных</div>
          )}
        </div>

        <p className="text-sm font-sans text-ink-tertiary leading-relaxed">
          Здесь только те две поверхности, где студент работает внутри платформы. Тесты, задания
          и темы уходят файлом — что с ними происходит дальше, платформа не видит и не может
          узнать: чтобы считать прохождение и время, нужна доставка студенту внутри ИСПУМ
          (или выставление через LTI), а это продуктовое решение, а не вопрос сбора метрик.
          Все цифры на странице — агрегаты по когорте: ни имени, ни почты, ни строки по
          конкретному студенту сюда не попадает. «Собрано вставкой» — доля работ, где больше
          половины текста пришло вставкой; это сигнал о постановке задания, а не приговор
          студенту.
        </p>
      </div>
    </div>
  )
}
