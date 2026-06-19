import type { BulletItem, BulletSeverity, BulletAction } from '../../types'

// Long-review chapter/overall bullets evolved across three tiers:
//   - Tier 0: plain string (legacy rows)
//   - Tier 1: BulletItem { text, quote? }
//   - Tier 3: BulletItem { ..., severity?, action?, correction? } on gaps
// Renderer accepts all three shapes so existing reviews still look right.
type Bullet = BulletItem | string

interface Props {
  bullet:  Bullet
  variant: 'positive' | 'negative'
}

// Severity → coloured dot before the bullet. Critical = danger, substantial =
// warning, minor = quiet ink-tertiary. Strengths never get a dot (severity
// doesn't apply to positive findings).
const SEVERITY_DOT_CLASS: Record<BulletSeverity, string> = {
  critical:    'bg-danger',
  substantial: 'bg-warning',
  minor:       'bg-ink-tertiary',
}

const SEVERITY_LABEL: Record<BulletSeverity, string> = {
  critical:    'критично',
  substantial: 'существенно',
  minor:       'незначительно',
}

const ACTION_LABEL: Record<BulletAction, string> = {
  flag:   'к проверке',
  verify: 'спросить автора',
}

const ACTION_CHIP_CLASS: Record<BulletAction, string> = {
  flag:   'bg-warning-bg text-warning',
  verify: 'bg-info-bg text-info',
}

export default function LongReviewBullet({ bullet, variant }: Props) {
  const text       = typeof bullet === 'string' ? bullet : bullet.text
  const quote      = typeof bullet === 'string' ? null   : bullet.quote      ?? null
  const severity   = typeof bullet === 'string' ? null   : bullet.severity   ?? null
  const action     = typeof bullet === 'string' ? null   : bullet.action     ?? null
  const correction = typeof bullet === 'string' ? null   : bullet.correction ?? null
  const isNegative = variant === 'negative'
  const marker      = isNegative ? '−' : '+'
  const markerClass = isNegative ? 'text-warning' : 'text-success'

  return (
    <div className="flex gap-1.5 text-xs text-ink-secondary mb-1.5 leading-relaxed">
      {/* Severity dot precedes the +/- marker on gaps. Strengths get just the +. */}
      {isNegative && severity && (
        <span
          className={`${SEVERITY_DOT_CLASS[severity]} w-2 h-2 rounded-full mt-1.5 flex-shrink-0`}
          title={SEVERITY_LABEL[severity]}
          aria-label={`severity: ${SEVERITY_LABEL[severity]}`}
        />
      )}
      <span className={`${markerClass} flex-shrink-0`}>{marker}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-start gap-1.5 flex-wrap">
          <span className="flex-1 min-w-0">{text}</span>
          {action && (
            <span
              className={`${ACTION_CHIP_CLASS[action]} text-[10px] font-sans font-medium px-1.5 py-0.5 rounded-sm flex-shrink-0 leading-tight`}
              title={action === 'verify' ? 'ИИ не уверен — стоит уточнить у автора' : 'ИИ нашёл расхождение — нужна проверка'}
            >
              {ACTION_LABEL[action]}
            </span>
          )}
        </div>
        {quote && (
          <div className="mt-0.5 flex gap-1 items-start">
            <span className="text-[10px] text-amber font-medium mt-0.5 flex-shrink-0">↳</span>
            <span className="text-[11.5px] italic text-ink-tertiary leading-relaxed border-l-2 border-amber/30 pl-2">
              «{quote}»
            </span>
          </div>
        )}
        {correction && (
          <div className="mt-1 flex gap-1 items-start">
            <span className="text-[10px] text-ink-tertiary mt-0.5 flex-shrink-0">→</span>
            <span className="text-[11.5px] text-ink-secondary leading-relaxed">
              {correction}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// Sort gaps by severity DESC (critical first). Bullets without a severity sink
// to the bottom — they're the "couldn't classify" tail. Stable for items of
// equal severity so the model's own ordering survives.
const SEVERITY_RANK: Record<BulletSeverity, number> = {
  critical: 3, substantial: 2, minor: 1,
}
export function sortGapsBySeverity<T extends Bullet>(bullets: T[]): T[] {
  return bullets
    .map((b, i) => ({ b, i, rank: rankOf(b) }))
    .sort((a, b) => b.rank - a.rank || a.i - b.i)
    .map((x) => x.b)
}
function rankOf(b: Bullet): number {
  if (typeof b === 'string') return 0
  return b.severity ? SEVERITY_RANK[b.severity] : 0
}
