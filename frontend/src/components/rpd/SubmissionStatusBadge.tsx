import type { RpdSubmissionStatus } from '../../types'

// Shared across all three surfaces of the РПД approval route (teacher's
// «Мои РПД», РОП Студия's review queue, УМЦ's approval queue) so the same
// status always reads the same colour everywhere (docs/RPD-WORKFLOW.md).

const STYLE: Record<RpdSubmissionStatus, string> = {
  draft:     'bg-surface-warm text-ink-secondary',
  submitted: 'bg-info-bg text-info',
  returned:  'bg-warning-bg text-warning',
  forwarded: 'bg-info-bg text-info',
  approved:  'bg-success-bg text-success',
}

const LABEL: Record<RpdSubmissionStatus, string> = {
  draft:     'Черновик',
  submitted: 'На проверке у РОП',
  returned:  'Возвращён',
  forwarded: 'На согласовании в УМЦ',
  approved:  'Согласован',
}

export default function SubmissionStatusBadge({ status }: { status: RpdSubmissionStatus }) {
  return (
    <span className={`text-xs font-sans font-medium px-2 py-0.5 rounded-sm whitespace-nowrap ${STYLE[status]}`}>
      {LABEL[status]}
    </span>
  )
}
