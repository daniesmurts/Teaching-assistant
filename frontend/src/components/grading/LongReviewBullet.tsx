import type { BulletItem } from '../../types'

// Long-review chapter/overall bullets evolved from plain string (Tier-0) to
// BulletItem with verbatim quote (Tier-1). Older review rows still carry
// strings inside the JSONB result column, so every renderer accepts both.
type Bullet = BulletItem | string

interface Props {
  bullet:  Bullet
  variant: 'positive' | 'negative'
}

export default function LongReviewBullet({ bullet, variant }: Props) {
  const text  = typeof bullet === 'string' ? bullet : bullet.text
  const quote = typeof bullet === 'string' ? null  : bullet.quote
  const marker = variant === 'positive' ? '+' : '−'
  const markerClass = variant === 'positive' ? 'text-success' : 'text-warning'
  return (
    <div className="flex gap-1.5 text-xs text-ink-secondary mb-1 leading-relaxed">
      <span className={`${markerClass} flex-shrink-0`}>{marker}</span>
      <div className="flex-1 min-w-0">
        <span>{text}</span>
        {quote && (
          <div className="mt-0.5 flex gap-1 items-start">
            <span className="text-[10px] text-amber font-medium mt-0.5 flex-shrink-0">↳</span>
            <span className="text-[11.5px] italic text-ink-tertiary leading-relaxed border-l-2 border-amber/30 pl-2">
              «{quote}»
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
