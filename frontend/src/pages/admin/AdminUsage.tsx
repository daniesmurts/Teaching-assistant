import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getArtifactUsage, getDailyUsage, getPresentationLifecycle, getUsageByFeature, getUsageByModel, getUsageByTeacher } from '../../api/admin'
import { ARTIFACT_LABEL } from '../../lib/artifactLabels'

type Tab = 'artifact' | 'lifecycle' | 'day' | 'feature' | 'model' | 'teacher'

// Spend buckets on api_usage_log — NOT product features. 'grading' is shared
// by ~15 services; use the «Артефакты» tab to see what was actually created.
const FEATURE_LABEL: Record<string, string> = {
  grading:             'Проверка (общий бюджет)',
  presentation:        'Презентации',
  feedback_email:      'Письма',
  embedding:           'Эмбеддинги',
  criteria_assist:     'Подсказки по критериям',
  rpd_reminder:        'Напоминания по РПД',
  document_extraction: 'Разбор документов',
}


const PROVIDER_LABEL: Record<string, string> = {
  deepseek: 'DeepSeek',
  yandex:   'Yandex',
  qwen:     'Qwen',
  gigachat: 'GigaChat',
}

function pct(part: number, total: number): string {
  if (!total) return '—'
  return `${Math.round((part / total) * 100)}%`
}

export default function AdminUsage() {
  const [tab, setTab]   = useState<Tab>('artifact')
  const [days, setDays] = useState(30)

  const { data: artifact = [] } = useQuery({ queryKey: ['admin-artifacts', days], queryFn: () => getArtifactUsage(days) })
  const { data: decks }         = useQuery({ queryKey: ['admin-deck-lifecycle', days], queryFn: () => getPresentationLifecycle(days) })
  const { data: daily = [] }   = useQuery({ queryKey: ['admin-daily', days],   queryFn: () => getDailyUsage(days) })
  const { data: feature = [] } = useQuery({ queryKey: ['admin-feature', days], queryFn: () => getUsageByFeature(days) })
  const { data: model = [] }   = useQuery({ queryKey: ['admin-model', days],   queryFn: () => getUsageByModel(days) })
  const { data: teacher = [] } = useQuery({ queryKey: ['admin-teachers-usage'], queryFn: getUsageByTeacher })

  const mtdCost = daily.reduce((s, d) => s + Number(d.cost_usd), 0)

  const tabClass = (t: Tab) =>
    `px-3 py-1.5 text-sm font-sans font-medium rounded-md whitespace-nowrap transition-colors ${
      tab === t ? 'bg-amber text-white' : 'text-ink-secondary hover:bg-surface-warm'
    }`

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-display text-2xl font-bold text-ink">Использование</h1>
          <div className="text-right">
            <div className="text-sm font-sans text-ink-tertiary">Расходы за период</div>
            <div className="font-display text-2xl font-bold text-amber">${mtdCost.toFixed(4)}</div>
          </div>
        </div>

        {/* Tabs + range */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex gap-1">
            <button className={tabClass('artifact')} onClick={() => setTab('artifact')}>Артефакты</button>
            <button className={tabClass('lifecycle')} onClick={() => setTab('lifecycle')}>Жизнь презентаций</button>
            <button className={tabClass('day')}     onClick={() => setTab('day')}>По дням</button>
            <button className={tabClass('feature')} onClick={() => setTab('feature')}>Расходы по функциям</button>
            <button className={tabClass('model')}   onClick={() => setTab('model')}>По моделям</button>
            <button className={tabClass('teacher')} onClick={() => setTab('teacher')}>По преподавателям</button>
          </div>
          {tab !== 'teacher' && (
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5"
            >
              <option value={7}>7 дней</option>
              <option value={30}>30 дней</option>
              <option value={90}>90 дней</option>
            </select>
          )}
        </div>

        {tab === 'lifecycle' && (() => {
          const l = decks?.lifecycle
          const stages = l ? [
            { label: 'Правились',        count: l.edited,      hint: 'хотя бы один слайд переписан или перегенерирован' },
            { label: 'Утверждены',       count: l.approved,    hint: null },
            { label: 'Выгружены',        count: l.exported,    hint: '.pptx или раздатка' },
            { label: 'Стали тестом / заданием', count: l.reused, hint: null },
            { label: 'Поделились',       count: l.shared,      hint: 'видимость шире личной' },
          ] : []
          return (
            <>
              <div className="bg-surface border border-border rounded-lg p-6 mb-4">
                <div className="flex items-baseline justify-between mb-5">
                  <div className="text-base font-sans font-medium text-ink">
                    Что стало с презентациями, созданными за период
                  </div>
                  {l && (
                    <div className="text-right">
                      <div className="text-sm font-sans text-ink-tertiary">Как-то использованы</div>
                      <div className="font-display text-2xl font-bold text-amber">
                        {l.engaged} из {l.total}
                        <span className="text-ink-tertiary text-base font-normal ml-2">{pct(l.engaged, l.total)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3">
                  {stages.map((st) => (
                    <div key={st.label} className="flex items-center gap-4">
                      <div className="w-56 flex-shrink-0">
                        <div className="text-sm font-sans text-ink-secondary">{st.label}</div>
                        {st.hint && <div className="text-xs font-sans text-ink-tertiary">{st.hint}</div>}
                      </div>
                      <div className="flex-1 h-6 bg-surface-warm rounded overflow-hidden">
                        <div className="h-full bg-amber/70 rounded transition-all"
                             style={{ width: l && l.total ? `${(st.count / l.total) * 100}%` : 0 }} />
                      </div>
                      <div className="w-24 text-sm font-sans text-ink text-right flex-shrink-0">
                        <span className="font-medium">{st.count}</span>
                        <span className="text-ink-tertiary ml-1">({pct(st.count, l?.total ?? 0)})</span>
                      </div>
                    </div>
                  ))}
                  {!l && <div className="text-sm font-sans text-ink-tertiary">Нет данных</div>}
                </div>

                {l && (
                  <div className="grid grid-cols-3 gap-6 mt-6 pt-5 border-t border-border text-sm font-sans">
                    <div>
                      <div className="text-ink-tertiary mb-0.5">Ни разу не тронуты</div>
                      <div className="font-medium text-ink">{l.total - l.engaged} из {l.total}</div>
                    </div>
                    <div>
                      <div className="text-ink-tertiary mb-0.5">До первого использования</div>
                      <div className="font-medium text-ink">
                        {l.median_days_to_engagement === null ? '—'
                          : l.median_days_to_engagement < 1 ? 'в тот же день'
                          : `${Math.round(l.median_days_to_engagement)} дн`}
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-tertiary mb-0.5">Использованы за 7 дней</div>
                      {l.mature_total > 0 ? (
                        <div className="font-medium text-ink">
                          {l.engaged_within_7d} из {l.mature_total} <span className="text-ink-tertiary">({pct(l.engaged_within_7d, l.mature_total)})</span>
                        </div>
                      ) : (
                        <div className="text-ink-tertiary">
                          пока не с чем сравнивать
                          {l.export_tracking_since && (
                            <span className="block text-xs mt-0.5">
                              учёт выгрузок с {new Date(l.export_tracking_since).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Что именно правят — сигнал качества генерации, а не использования */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="bg-surface border border-border rounded-lg p-5">
                  <div className="text-sm font-sans font-medium text-ink mb-3">Какие слайды переписывают</div>
                  <table className="w-full text-sm font-sans">
                    <tbody>
                      {(decks?.hotspots ?? []).slice(0, 8).map((h) => (
                        <tr key={h.slide_type} className="border-b border-border last:border-0">
                          <td className="py-1.5 text-ink">{h.slide_type}</td>
                          <td className="py-1.5 text-right text-ink-secondary">{h.events}</td>
                          <td className="py-1.5 text-right text-ink-tertiary w-28">
                            {h.regenerations > 0 ? `${h.regenerations} перегенер.` : '—'}
                          </td>
                        </tr>
                      ))}
                      {(decks?.hotspots ?? []).length === 0 && (
                        <tr><td className="py-3 text-ink-tertiary">Правок за период не было</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="bg-surface border border-border rounded-lg p-5">
                  <div className="text-sm font-sans font-medium text-ink mb-1">Что просят исправить</div>
                  <div className="text-xs font-sans text-ink-tertiary mb-3">
                    Текст, который преподаватель писал при перегенерации слайда
                  </div>
                  <div className="space-y-1.5 max-h-64 overflow-y-auto">
                    {(decks?.instructions ?? []).map((i, idx) => (
                      <div key={idx} className="text-sm font-sans text-ink border-b border-border last:border-0 pb-1.5">
                        «{i.instruction}»
                        {i.slide_type && <span className="text-ink-tertiary ml-2 text-xs">{i.slide_type}</span>}
                      </div>
                    ))}
                    {(decks?.instructions ?? []).length === 0 && (
                      <div className="text-sm font-sans text-ink-tertiary">Пока никто ничего не просил</div>
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs font-sans text-ink-tertiary leading-relaxed">
                «Выгружено» перестало быть мерой пользы, как только слайды стало можно править
                на платформе: преподаватель, который довёл презентацию в браузере и показал её
                оттуда же, ничего не скачивает. Поэтому здесь считается любое из действий —
                правка, утверждение, выгрузка, переиспользование, публикация. Столбец
                «Использованы за 7 дней» — единственный, который честно сравнивать между
                релизами: в него попадают только презентации, у которых эти 7 дней уже были,
                и только то, что случилось внутри них. Презентации, чья неделя прошла до
                включения учёта выгрузок, не считаются вовсе — иначе цифра измеряла бы возраст
                телеметрии, а не поведение.
              </p>
            </>
          )
        })()}

        <div className={`bg-surface border border-border rounded-lg overflow-hidden ${tab === 'lifecycle' ? 'hidden' : ''}`}>
          <table className="w-full text-sm font-sans">
            {tab === 'artifact' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Функция</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Создано за период</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Преподавателей</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Всего за всё время</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Выгрузок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Последнее</th>
                </tr></thead>
                <tbody>
                  {artifact.map((r) => (
                    <tr key={r.kind} className={`border-b border-border last:border-0 ${r.total_count === 0 ? 'opacity-50' : ''}`}>
                      <td className="px-3 py-2 text-ink">{ARTIFACT_LABEL[r.kind] ?? r.kind}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.period_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.period_teachers > 0 ? r.period_teachers : '—'}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">
                        {r.export_count > 0 ? (
                          <span title={`${r.exported_items} объектов, ${r.export_teachers} преподавателей`}>
                            {r.export_count}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-ink-tertiary">
                        {r.last_at ? new Date(r.last_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' }) : 'никогда'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}

            {tab === 'day' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Дата</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Презентаций</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {daily.map((r) => (
                    <tr key={r.date} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{new Date(r.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.grade_count}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.presentation_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {daily.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}

            {tab === 'feature' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Функция</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Вызовов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Ср. токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Всего токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {feature.map((r) => (
                    <tr key={r.feature} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{FEATURE_LABEL[r.feature] ?? r.feature}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.call_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.avg_tokens_per_call.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {feature.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}

            {tab === 'model' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Провайдер</th>
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Модель</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Вызовов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Ошибок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {model.map((r) => (
                    <tr key={`${r.provider}:${r.model}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-ink">{PROVIDER_LABEL[r.provider] ?? r.provider}</td>
                      <td className="px-3 py-2 text-ink-secondary">{r.model}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.call_count}</td>
                      <td className="px-3 py-2 text-right text-ink">{r.error_count > 0 ? r.error_count : '—'}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {model.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}

            {tab === 'teacher' && (
              <>
                <thead><tr className="border-b border-border bg-surface-warm">
                  <th className="text-left px-3 py-2 text-ink-secondary font-medium">Преподаватель</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Проверок</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Токенов</th>
                  <th className="text-right px-3 py-2 text-ink-secondary font-medium">Стоимость</th>
                </tr></thead>
                <tbody>
                  {teacher.map((r) => (
                    <tr key={r.teacher_id} className="border-b border-border last:border-0">
                      <td className="px-3 py-2">
                        <div className="text-ink font-medium">{r.teacher_name ?? r.email}</div>
                        <div className="text-ink-tertiary">{r.email}</div>
                      </td>
                      <td className="px-3 py-2 text-right text-ink">{r.grade_count}</td>
                      <td className="px-3 py-2 text-right text-ink-secondary">{r.total_tokens.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right font-medium text-ink">${Number(r.cost_usd).toFixed(4)}</td>
                    </tr>
                  ))}
                  {teacher.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-ink-tertiary">Нет данных</td></tr>}
                </tbody>
              </>
            )}
          </table>
        </div>

        {tab === 'artifact' && (
          <p className="mt-3 text-xs font-sans text-ink-tertiary leading-relaxed">
            «Создано» и «Выгружено» — разные вопросы: первое считается по таблицам артефактов
            задним числом за всю историю, второе фиксируется с момента включения учёта, поэтому
            у старых объектов выгрузок не будет. Наведите курсор на число выгрузок, чтобы увидеть,
            скольких объектов и преподавателей они касаются. Правки после генерации здесь пока
            не отражены. У программных артефактов (анализ программ, экспертиза РПД, сводки,
            памятки) автор не сохраняется, поэтому столбец «Преподавателей» для них пуст.
          </p>
        )}

        {tab === 'feature' && (
          <p className="mt-3 text-xs font-sans text-ink-tertiary leading-relaxed">
            Это бюджеты вызовов модели, а не функции продукта. «Проверка» — общий бюджет,
            в который пишут и проверка работ, и тесты, и задания, и анализ программ, причём
            одно действие преподавателя даёт несколько вызовов. Реальную активность
            смотрите на вкладке «Артефакты».
          </p>
        )}
      </div>
    </div>
  )
}
