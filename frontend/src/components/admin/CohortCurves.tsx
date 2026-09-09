import type { PresentationCohort } from '../../../../shared/types'
import { RELEASE_MARKERS } from '../../../../shared/releaseMarkers'

// Cohort engagement curves, drawn by hand in SVG — the project carries no
// charting library and one dependency for one chart is a poor trade.
//
// One line per weekly creation cohort: what share of that week's decks were
// used within 1 / 3 / 7 / 14 / 30 days OF THEIR OWN CREATION. Plotting
// "engagement this month" instead would move with how many decks were made,
// which is exactly the confusion the 62-vs-14 figure caused.
//
// Observability is per deck, so a horizon carries its own denominator: the
// decks that have actually lived that long. A horizon nobody has reached yet
// has observed = 0 and is simply absent from the line — a point on the axis
// would read as "nobody used them" when it means "not measurable yet".

const W = 560
const H = 240
const PAD = { top: 16, right: 16, bottom: 30, left: 38 }

function x(index: number, count: number): number {
  if (count <= 1) return PAD.left
  return PAD.left + (index / (count - 1)) * (W - PAD.left - PAD.right)
}
function y(share: number): number {
  return PAD.top + (1 - share) * (H - PAD.top - PAD.bottom)
}

function shortWeek(iso: string): string {
  return new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

export default function CohortCurves({ cohorts }: { cohorts: PresentationCohort[] }) {
  const hasData = (c: PresentationCohort) => c.horizons.some((h) => h.observed > 0)
  const tracked = cohorts.filter((c) => c.cohort_size > 0 && hasData(c))
  const untracked = cohorts.filter((c) => c.cohort_size > 0 && !hasData(c))
  const axis = cohorts[0]?.horizons ?? []

  // Oldest first, so the opacity ramp reads chronologically.
  const ordered = [...tracked].reverse()

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="text-sm font-sans font-medium text-ink mb-1">
        Когорты: доля использованных за N дней с момента создания
      </div>
      <div className="text-xs font-sans text-ink-tertiary mb-4">
        Каждая линия — презентации, созданные за одну неделю. В знаменателе каждой точки
        только те колоды, которые этот срок уже прожили, поэтому линия обрывается там, где
        срок ещё не наступил: точка на нуле означала бы «не пользовались», а не «рано судить».
      </div>

      {ordered.length === 0 ? (
        <div className="text-sm font-sans text-ink-tertiary py-8 text-center">
          {untracked.length > 0
            ? 'Все когорты созданы до включения учёта выгрузок — сравнивать пока нечего.'
            : 'Нет данных за выбранный период.'}
        </div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
             aria-label="Кривые использования по когортам создания презентаций">
          {[0, 0.25, 0.5, 0.75, 1].map((g) => (
            <g key={g}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(g)} y2={y(g)}
                    stroke="currentColor" className="text-border" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(g) + 3} textAnchor="end"
                    className="fill-current text-ink-tertiary" style={{ fontSize: 9 }}>
                {Math.round(g * 100)}%
              </text>
            </g>
          ))}

          {axis.map((h, i) => (
            <text key={h.days} x={x(i, axis.length)} y={H - 10} textAnchor="middle"
                  className="fill-current text-ink-tertiary" style={{ fontSize: 9 }}>
              {h.days} дн
            </text>
          ))}

          {ordered.map((c, ci) => {
            const points = c.horizons
              .map((h, i) => (h.observed === 0 ? null : { i, share: h.engaged / h.observed }))
              .filter((p): p is { i: number; share: number } => p !== null)
            if (points.length === 0) return null

            const opacity = 0.35 + (0.65 * (ci + 1)) / ordered.length
            const path = points
              .map((p, k) => `${k === 0 ? 'M' : 'L'} ${x(p.i, c.horizons.length)} ${y(p.share)}`)
              .join(' ')

            return (
              <g key={c.week} opacity={opacity}>
                <path d={path} fill="none" stroke="currentColor" className="text-amber" strokeWidth={2} />
                {points.map((p) => (
                  <circle key={p.i} cx={x(p.i, c.horizons.length)} cy={y(p.share)} r={3}
                          className="fill-current text-amber" />
                ))}
              </g>
            )
          })}
        </svg>
      )}

      <div className="mt-3 space-y-1">
        {ordered.map((c) => (
          <div key={c.week} className="flex items-center justify-between text-xs font-sans">
            <span className="text-ink-secondary">
              неделя {shortWeek(c.week)} — {c.cohort_size} презентаций
            </span>
            <span className="text-ink-tertiary">
              {(() => {
                const last = [...c.horizons].reverse().find((h) => h.observed > 0)
                if (!last) return 'слишком рано'
                return `наблюдается до ${last.days} дн (${last.engaged} из ${last.observed})`
              })()}
            </span>
          </div>
        ))}
        {untracked.length > 0 && (
          <div className="text-xs font-sans text-ink-tertiary pt-1">
            Когорт без наблюдаемых сроков: {untracked.length}. Либо созданы до включения
            учёта выгрузок (записать выгрузку было невозможно), либо срок ещё не прошёл.
          </div>
        )}
      </div>

      <div className="mt-4 pt-4 border-t border-border">
        <div className="text-xs font-sans font-medium text-ink-secondary mb-2">Что менялось</div>
        <div className="space-y-2">
          {[...RELEASE_MARKERS].sort((a, b) => b.date.localeCompare(a.date)).map((m) => (
            <div key={`${m.date}-${m.label}`} className="flex gap-3 text-xs font-sans">
              <span className={`flex-shrink-0 w-1 rounded ${m.kind === 'instrumentation' ? 'bg-ink-tertiary' : 'bg-amber'}`} />
              <span className="text-ink-tertiary w-20 flex-shrink-0">
                {new Date(m.date).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}
              </span>
              <span className="flex-1">
                <span className="text-ink">{m.label}</span>
                {m.kind === 'instrumentation' && (
                  <span className="text-ink-tertiary"> · граница наблюдаемости</span>
                )}
                {m.expect && <span className="block text-ink-tertiary mt-0.5">{m.expect}</span>}
              </span>
            </div>
          ))}
        </div>
        <div className="text-xs font-sans text-ink-tertiary mt-3 leading-relaxed">
          Функции, выкатанные одним релизом, в данных неразличимы: изменение можно отнести
          к релизу, но не к одной его части. Через границу наблюдаемости сравнивать нельзя вовсе.
        </div>
      </div>
    </div>
  )
}
