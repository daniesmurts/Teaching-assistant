import { useQuery } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import FeatureIntro from '../components/ui/FeatureIntro'
import { getLearningLoopSummary, type LearningLoopSummary } from '../api/learningLoop'

const MIN_SAMPLE = 5

/**
 * The «Учебный цикл» page — the visible flywheel.
 *
 * Four cards on top + a trend chart + an explanation block at the bottom.
 * Every metric has an explicit "not enough data yet" state so a fresh
 * teacher sees encouragement, not zeros.
 */
export default function LearningLoop() {
  const { data, isLoading } = useQuery({
    queryKey: ['learning-loop-summary'],
    queryFn:  getLearningLoopSummary,
    staleTime: 5 * 60_000,
  })

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Учебный цикл" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-6 space-y-6">
          <FeatureIntro
            id="learning-loop"
            title="ИСПУМ учится у вас — посмотрите, как"
            description="Каждая ваша утверждённая оценка возвращается в систему как образец: при следующей проверке похожей работы ИСПУМ опирается на ваши прошлые решения, а не на абстрактные стандарты. Чем больше вы проверяете, тем ближе автоматические оценки становятся к вашему стилю."
            steps={[
              'Проверяете работу — ИСПУМ предлагает черновик.',
              'Корректируете и утверждаете — это сигнал для системы.',
              'При следующей похожей работе ваше решение используется как образец.',
              'Согласие между ИСПУМ и вашими оценками растёт со временем.',
            ]}
          />

          {isLoading || !data ? (
            <Skeleton />
          ) : (
            <>
              <CardGrid data={data} />
              <TrendChart series={data.trend_weekly} />
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Card grid ───────────────────────────────────────────────────────────────

function CardGrid({ data }: { data: LearningLoopSummary }) {
  const { style_match, approved, used_as_example_30d, bullets_retention_30d } = data

  const styleMatchEnough = style_match.current_pct != null && style_match.sample_n_30d >= MIN_SAMPLE
  const retentionEnough  = bullets_retention_30d.pct != null && bullets_retention_30d.sample_n >= MIN_SAMPLE

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {/* Hero card — style match */}
      <MetricCard
        accent
        label="Похожесть автоматической оценки на ваш стиль"
        value={styleMatchEnough ? `${style_match.current_pct}%` : null}
        sub={
          styleMatchEnough
            ? `на основе ${style_match.sample_n_30d} работ за 30 дней`
            : `нужно ещё ${MIN_SAMPLE - style_match.sample_n_30d} утверждённых работ`
        }
        trendDelta={styleMatchEnough ? style_match.delta : null}
        trendUnit="п.п."
      />

      {/* Volume */}
      <MetricCard
        label="Утверждено работ"
        value={approved.lifetime.toString()}
        sub={
          approved.this_month > 0
            ? `${approved.this_month} в этом месяце ${formatDelta(approved.delta_vs_last_month, 'к прошлому')}`
            : approved.lifetime === 0
              ? 'утвердите первую работу — система начнёт учиться'
              : 'нет проверок в этом месяце'
        }
      />

      {/* Used as RAG example */}
      <MetricCard
        label="Ваши работы как образец для системы"
        value={used_as_example_30d.toString()}
        sub={
          used_as_example_30d > 0
            ? 'случаев за 30 дней, когда система опиралась на ваши прошлые оценки'
            : 'появится после ≥ 2 утверждённых работ по одному предмету'
        }
      />

      {/* Bullets retention */}
      <MetricCard
        label="Сохранено пунктов рубрики"
        value={retentionEnough ? `${bullets_retention_30d.pct}%` : null}
        sub={
          retentionEnough
            ? `на основе ${bullets_retention_30d.sample_n} работ за 30 дней`
            : 'появится после ≥ 5 утверждённых работ'
        }
      />

      {/* Kafedra contribution — only visible when the institutional flywheel
          has produced cross-uses. Hidden entirely for non-institutional
          teachers so the grid stays a clean 2×2. */}
      {data.kafedra_contribution_30d > 0 && (
        <MetricCard
          label="Ваш вклад в кафедру"
          value={data.kafedra_contribution_30d.toString()}
          sub="случаев за 30 дней, когда ваши оценки стали образцом для коллег"
        />
      )}
    </div>
  )
}

function formatDelta(d: number, suffix: string): string {
  if (d === 0) return `(столько же ${suffix})`
  if (d > 0)   return `(+${d} ${suffix})`
  return `(${d} ${suffix})`
}

interface MetricCardProps {
  label:        string
  value:        string | null
  sub?:         string
  accent?:      boolean
  trendDelta?:  number | null
  trendUnit?:   string
}

function MetricCard({ label, value, sub, accent, trendDelta, trendUnit }: MetricCardProps) {
  const border = accent ? 'bg-amber-light border-amber/20' : 'bg-surface border-border'
  const labelClr = accent ? 'text-amber' : 'text-ink-secondary'
  const valueClr = accent ? 'text-amber' : 'text-ink'
  const subClr   = accent ? 'text-amber/70' : 'text-ink-tertiary'

  return (
    <div className={`border rounded-lg p-4 ${border}`}>
      <div className={`text-xs font-sans font-medium mb-2 ${labelClr}`}>{label}</div>
      <div className="flex items-baseline gap-2">
        <div className={`font-display text-3xl font-bold leading-none ${valueClr}`}>
          {value ?? '—'}
        </div>
        {trendDelta != null && Math.abs(trendDelta) >= 0.5 && (
          <TrendBadge delta={trendDelta} unit={trendUnit ?? ''} />
        )}
      </div>
      {sub && (
        <div className={`text-xs font-sans mt-2 leading-relaxed ${subClr}`}>{sub}</div>
      )}
    </div>
  )
}

function TrendBadge({ delta, unit }: { delta: number; unit: string }) {
  const positive = delta > 0
  const cls = positive ? 'bg-success-bg text-success' : 'bg-warning-bg text-warning'
  const sign = positive ? '↑' : '↓'
  return (
    <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm ${cls}`}>
      {sign} {Math.abs(delta).toFixed(1)} {unit}
    </span>
  )
}

// ─── Trend chart ─────────────────────────────────────────────────────────────
//
// Weekly mean |ai_score − approved_score|, last 6 months. We render with a
// simple SVG polyline rather than pulling in a chart lib — the shape is the
// signal, scale labels are minimal.

function TrendChart({ series }: { series: LearningLoopSummary['trend_weekly'] }) {
  if (series.length < 2) {
    return (
      <div className="bg-surface border border-border rounded-lg p-6 text-center">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Динамика согласия со временем
        </div>
        <p className="text-sm text-ink-secondary">
          Появится после нескольких недель с утверждёнными работами — мы сможем показать, как система постепенно приближается к вашему стилю.
        </p>
      </div>
    )
  }

  const W = 720, H = 200, PAD = { l: 36, r: 16, t: 16, b: 32 }
  const innerW = W - PAD.l - PAD.r
  const innerH = H - PAD.t - PAD.b

  // Y axis: |delta| from 0 to a sensible upper bound (max in series rounded up
  // to next multiple of 5, minimum 20).
  const maxDelta = Math.max(20, Math.ceil(Math.max(...series.map((s) => s.mean_delta)) / 5) * 5)

  const x = (i: number) => PAD.l + (series.length === 1 ? innerW / 2 : (i / (series.length - 1)) * innerW)
  const y = (v: number) => PAD.t + innerH - (v / maxDelta) * innerH

  const path = series.map((s, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(s.mean_delta)}`).join(' ')

  // Last point + first point labels — keeps the axis readable without ticks.
  const firstWeek = series[0].week
  const lastWeek  = series[series.length - 1].week

  return (
    <div className="bg-surface border border-border rounded-lg p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          Динамика согласия со временем
        </div>
        <div className="text-[11px] font-sans text-ink-tertiary">
          среднее расхождение автооценки ↔ ваш балл
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
        {/* Y grid: 0, mid, max */}
        {[0, maxDelta / 2, maxDelta].map((tick) => (
          <g key={tick}>
            <line x1={PAD.l} y1={y(tick)} x2={W - PAD.r} y2={y(tick)} stroke="var(--color-border)" strokeWidth="1" strokeDasharray="2 4" />
            <text x={PAD.l - 6} y={y(tick) + 3} textAnchor="end" className="fill-ink-tertiary text-[10px] font-sans">{tick}</text>
          </g>
        ))}
        {/* Line */}
        <path d={path} fill="none" stroke="var(--color-amber)" strokeWidth="2" />
        {/* Points */}
        {series.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.mean_delta)} r="3" fill="var(--color-amber)" />
        ))}
        {/* Edge week labels */}
        <text x={PAD.l} y={H - 8} textAnchor="start" className="fill-ink-tertiary text-[10px] font-sans">{formatWeek(firstWeek)}</text>
        <text x={W - PAD.r} y={H - 8} textAnchor="end" className="fill-ink-tertiary text-[10px] font-sans">{formatWeek(lastWeek)}</text>
      </svg>
      <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed mt-2">
        Чем ниже линия и чем устойчивее снижение, тем ближе автоматические оценки к вашим решениям. Идеально — постепенное снижение в сторону нуля.
      </p>
    </div>
  )
}

function formatWeek(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="bg-surface border border-border rounded-lg p-4">
            <div className="h-3 bg-border rounded w-1/2 mb-3" />
            <div className="h-8 bg-border rounded w-1/3 mb-2" />
            <div className="h-3 bg-border rounded w-3/4" />
          </div>
        ))}
      </div>
      <div className="bg-surface border border-border rounded-lg p-6">
        <div className="h-3 bg-border rounded w-1/3 mb-3" />
        <div className="h-32 bg-border rounded" />
      </div>
    </>
  )
}
