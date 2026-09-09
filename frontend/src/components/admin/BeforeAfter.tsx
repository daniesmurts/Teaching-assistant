import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBeforeAfter } from '../../api/admin'
import { RELEASE_MARKERS } from '../../../../shared/releaseMarkers'
import type { WithinSubjectMetric } from '../../../../shared/types'

// Each teacher against themselves, across a release date.
//
// The confound this exists to remove is population mix: a plain before/after
// compares two different sets of people, and at single-digit weekly actives one
// teacher's busy fortnight moves every pooled rate more than a feature will.
//
// Nothing here is causal. A release is confounded with everything else that
// happened that week — term start, a holiday, a support conversation. The page
// says so, because a table of deltas invites being read as proof.

const FEATURE_RELEASES = RELEASE_MARKERS.filter((m) => m.kind === 'feature')

function fmt(value: number | null, key: WithinSubjectMetric['key']): string {
  if (value === null) return '—'
  if (key === 'decks_created') return value.toFixed(1)
  return `${Math.round(value * 100)}%`
}

function fmtDelta(value: number | null, key: WithinSubjectMetric['key']): string {
  if (value === null) return '—'
  const sign = value > 0 ? '+' : ''
  if (key === 'decks_created') return `${sign}${value.toFixed(1)}`
  return `${sign}${Math.round(value * 100)} п.п.`
}

export default function BeforeAfter() {
  const [date, setDate] = useState(FEATURE_RELEASES[0]?.date ?? '')
  const [days, setDays] = useState(14)

  const { data } = useQuery({
    queryKey: ['admin-before-after', date, days],
    queryFn: () => getBeforeAfter(date, days),
    enabled: Boolean(date),
  })

  const marker = RELEASE_MARKERS.find((m) => m.date === date)
  const thin = data ? data.matched_teachers < 5 : false

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-sm font-sans font-medium text-ink mb-1">
        До и после релиза — каждый преподаватель сам с собой
      </div>
      <div className="text-xs font-sans text-ink-tertiary mb-4">
        Сравниваются только те, кто создавал презентации по обе стороны даты. Иначе сравнение
        показывает не эффект функции, а то, что в одном окне работали одни люди, а в другом другие.
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select value={date} onChange={(e) => setDate(e.target.value)}
                className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5">
          {FEATURE_RELEASES.map((m) => (
            <option key={m.date} value={m.date}>{m.date} — {m.label.slice(0, 46)}</option>
          ))}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
                className="text-sm font-sans bg-surface border border-border rounded-md px-2 py-1.5">
          <option value={7}>±7 дней</option>
          <option value={14}>±14 дней</option>
          <option value={30}>±30 дней</option>
        </select>
      </div>

      {marker?.expect && (
        <div className="text-xs font-sans text-ink-secondary bg-surface-warm rounded-md p-3 mb-4">
          <span className="text-ink-tertiary">Чего ждали: </span>{marker.expect}
        </div>
      )}

      {!data ? (
        <div className="text-sm font-sans text-ink-tertiary py-6 text-center">Нет данных</div>
      ) : (
        <>
          <div className="flex flex-wrap gap-6 text-xs font-sans mb-4">
            <div>
              <span className="text-ink-tertiary">Сравнимы: </span>
              <span className="font-medium text-ink">{data.matched_teachers} преподавателей</span>
            </div>
            <div>
              <span className="text-ink-tertiary">Были только до: </span>
              <span className="text-ink">{data.before_only}</span>
            </div>
            <div>
              <span className="text-ink-tertiary">Появились только после: </span>
              <span className="text-ink">{data.after_only}</span>
            </div>
          </div>

          {thin && (
            <div className="text-xs font-sans text-ink bg-surface-warm border border-border rounded-md p-3 mb-4">
              {data.matched_teachers === 0
                ? 'Ни один преподаватель не работал по обе стороны даты — сравнивать некого. Это не «нет эффекта», это отсутствие выборки.'
                : `Всего ${data.matched_teachers} преподавателей по обе стороны: любую цифру ниже определяет один-два человека. Читайте столбцы «улучшилось / ухудшилось», а не медиану.`}
            </div>
          )}

          <table className="w-full text-sm font-sans">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left py-2 text-ink-secondary font-medium">Метрика</th>
                <th className="text-right py-2 text-ink-secondary font-medium">До</th>
                <th className="text-right py-2 text-ink-secondary font-medium">После</th>
                <th className="text-right py-2 text-ink-secondary font-medium">Медиана изменения</th>
                <th className="text-right py-2 text-ink-secondary font-medium">↑ / ↓ / =</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.key} className={`border-b border-border last:border-0 ${m.comparable ? '' : 'opacity-60'}`}>
                  <td className="py-2 text-ink">
                    {m.label}
                    {!m.comparable && (
                      <div className="text-xs text-ink-tertiary">
                        сигнал пишется только с {m.unavailable_before} — сравнивать не с чем
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right text-ink-secondary">{fmt(m.before_median, m.key)}</td>
                  <td className="py-2 text-right text-ink-secondary">{fmt(m.after_median, m.key)}</td>
                  <td className={`py-2 text-right font-medium ${
                    m.median_delta === null ? 'text-ink-tertiary'
                      : m.median_delta > 0 ? 'text-ink' : m.median_delta < 0 ? 'text-ink' : 'text-ink-tertiary'
                  }`}>
                    {fmtDelta(m.median_delta, m.key)}
                  </td>
                  <td className="py-2 text-right text-ink-tertiary">
                    {m.comparable ? `${m.improved} / ${m.worsened} / ${m.unchanged}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-xs font-sans text-ink-tertiary leading-relaxed mt-4">
            «Медиана изменения» — медиана изменений по каждому преподавателю, а не разница
            медиан: если девять улучшились чуть-чуть, а один рухнул, первая покажет улучшение,
            вторая может показать что угодно. Сравнение снимает разницу в составе людей, но не
            во времени: релиз всегда идёт вместе с началом семестра, праздниками и разговорами
            с поддержкой. Это не доказательство причины.
          </p>
        </>
      )}
    </div>
  )
}
