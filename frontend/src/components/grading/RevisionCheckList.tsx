import type { RevisionCheckItem } from '../../types'

interface Props {
  items: RevisionCheckItem[]
}

// Rendered on the result + past-work detail views when this is a revision.
// Shows each previous-version improvement and whether it was actually addressed.
export default function RevisionCheckList({ items }: Props) {
  if (!items?.length) return null

  return (
    <section>
      <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
        Учёт замечаний прошлой версии
      </div>
      <div className="space-y-2">
        {items.map((it, i) => <Row key={i} item={it} />)}
      </div>
    </section>
  )
}

function Row({ item }: { item: RevisionCheckItem }) {
  const meta = STATUS[item.status] ?? STATUS.partial
  return (
    <div className={`flex items-start gap-3 px-3 py-2.5 rounded-md border ${meta.bg} ${meta.border}`}>
      <span className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold ${meta.iconBg} ${meta.iconText}`}>
        {meta.icon}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-sans text-ink leading-snug">{item.point}</div>
        {item.note && (
          <div className={`text-xs font-sans leading-relaxed mt-1 ${meta.noteText}`}>{item.note}</div>
        )}
      </div>
      <span className={`text-[10px] font-sans font-semibold uppercase tracking-wider flex-shrink-0 ${meta.label}`}>
        {meta.labelText}
      </span>
    </div>
  )
}

const STATUS: Record<RevisionCheckItem['status'], {
  icon: string; label: string; labelText: string
  bg: string; border: string; iconBg: string; iconText: string; noteText: string
}> = {
  addressed: {
    icon: '✓', labelText: 'Учтено',
    label: 'text-success',
    bg: 'bg-success-bg', border: 'border-success/15',
    iconBg: 'bg-success', iconText: 'text-white',
    noteText: 'text-ink-secondary',
  },
  partial: {
    icon: '◐', labelText: 'Частично',
    label: 'text-warning',
    bg: 'bg-warning-bg', border: 'border-warning/15',
    iconBg: 'bg-warning', iconText: 'text-white',
    noteText: 'text-ink-secondary',
  },
  not_addressed: {
    icon: '×', labelText: 'Не учтено',
    label: 'text-danger',
    bg: 'bg-danger-bg', border: 'border-danger/15',
    iconBg: 'bg-danger', iconText: 'text-white',
    noteText: 'text-ink-secondary',
  },
}
