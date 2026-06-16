import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { getLearningLoopSummary } from '../../api/learningLoop'

/**
 * Compact "ИИ учится у вас" card for the Dashboard. Hero metric only —
 * the full breakdown lives at /learning-loop.
 *
 * Below the minimum sample size (we need ~5 approved grades in the window
 * for the % to mean anything) we show a friendly empty state instead of a
 * misleading number.
 */
const MIN_SAMPLE = 5

export default function LearningLoopCard() {
  const { data, isLoading } = useQuery({
    queryKey: ['learning-loop-summary'],
    queryFn:  getLearningLoopSummary,
    staleTime: 5 * 60_000,   // 5 min — nothing here changes second-to-second
  })

  if (isLoading) return <Skeleton />
  if (!data) return null

  const { style_match } = data
  const hasEnough = style_match.current_pct != null && style_match.sample_n_30d >= MIN_SAMPLE

  return (
    <div className="bg-surface border border-border rounded-lg p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
          ИИ учится у вас
        </div>
        <span className="text-[10px] font-sans text-ink-tertiary">за 30 дней</span>
      </div>

      {hasEnough ? (
        <>
          <div className="flex items-baseline gap-2 mb-1">
            <div className="font-display text-3xl font-bold text-ink leading-none">
              {style_match.current_pct}%
            </div>
            {style_match.delta != null && Math.abs(style_match.delta) >= 0.5 && (
              <TrendBadge delta={style_match.delta} />
            )}
          </div>
          <div className="text-xs font-sans text-ink-secondary leading-relaxed">
            Похожесть оценки ИИ на ваш стиль
          </div>
          <div className="text-[11px] font-sans text-ink-tertiary mt-2">
            На основе {style_match.sample_n_30d} утверждённых работ
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-xs font-sans text-ink-secondary leading-relaxed">
            Когда вы утвердите {MIN_SAMPLE}+ работ, мы покажем, насколько оценки ИИ совпадают с вашими решениями. Цифра будет расти по мере того, как система запоминает ваш стиль.
          </div>
        </div>
      )}

      <Link to="/learning-loop" className="mt-auto pt-3 text-xs font-sans font-medium text-amber hover:underline">
        Подробнее →
      </Link>
    </div>
  )
}

function TrendBadge({ delta }: { delta: number }) {
  const positive = delta > 0
  const cls = positive
    ? 'bg-success-bg text-success'
    : 'bg-warning-bg text-warning'
  const sign = positive ? '↑' : '↓'
  return (
    <span className={`text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm ${cls}`}>
      {sign} {Math.abs(delta).toFixed(1)} п.п.
    </span>
  )
}

function Skeleton() {
  return (
    <div className="bg-surface border border-border rounded-lg p-4 h-full">
      <div className="h-3 bg-border rounded w-1/2 mb-3" />
      <div className="h-8 bg-border rounded w-1/3 mb-2" />
      <div className="h-3 bg-border rounded w-3/4" />
    </div>
  )
}
