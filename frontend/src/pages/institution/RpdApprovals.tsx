import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../../components/ui/Button'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import SubmissionStatusBadge from '../../components/rpd/SubmissionStatusBadge'
import { getForwardedQueue, actOnForwardedSubmission } from '../../api/rpdApprovals'
import { useUIStore } from '../../store/uiStore'
import type { RpdSubmission } from '../../types'

// УМЦ's side of the РПД approval route (docs/RPD-WORKFLOW.md phase 4b) —
// 'forwarded' items institution-wide, gated on the `umu` domain (see
// docs/ACCESS-MATRIX.md — separate from `curriculum` so a Заведующий
// кафедрой doesn't see institution-wide approval traffic).

function coveragePct(s: RpdSubmission): string {
  return s.coverage != null ? `${s.coverage}%` : '—'
}

function ForwardedCard({ submission, onAct, busy }: {
  submission: RpdSubmission
  onAct: (submissionId: string, action: 'return' | 'approve', comment?: string) => void
  busy: boolean
}) {
  const [comment, setComment] = useState('')
  const [showReturn, setShowReturn] = useState(false)

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-sans text-sm font-medium text-ink">{submission.discipline_name}</h3>
            <SubmissionStatusBadge status={submission.status} />
          </div>
          <div className="text-xs font-sans text-ink-tertiary mt-1">
            {submission.program_code && <span>{submission.program_code} · </span>}
            {submission.program_name}
            {submission.responsible_teacher_name && <span> · {submission.responsible_teacher_name}</span>}
          </div>
        </div>
        <div className="text-right flex-shrink-0">
          <div className="text-[10px] font-sans text-ink-tertiary uppercase tracking-wider">Покрытие анализом</div>
          <div className="text-sm font-sans font-medium text-ink">{coveragePct(submission)}</div>
        </div>
      </div>

      {showReturn ? (
        <div className="mt-3 space-y-2">
          <textarea
            className="w-full text-xs font-sans bg-canvas border border-border rounded-md px-2.5 py-1.5 min-h-[70px] resize-y"
            placeholder="Замечания — что нужно исправить"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
          <div className="flex gap-2">
            <Button
              size="sm" variant="danger" disabled={busy || !comment.trim()}
              onClick={() => onAct(submission.id, 'return', comment.trim())}
            >
              Вернуть с замечаниями
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowReturn(false)}>Отмена</Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex gap-2">
          <Button size="sm" disabled={busy} onClick={() => onAct(submission.id, 'approve')}>
            {busy ? <LoadingSpinner size={13} /> : null} Согласовать
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setShowReturn(true)}>Вернуть</Button>
        </div>
      )}
    </div>
  )
}

export default function RpdApprovals() {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const { data: submissions = [], isLoading } = useQuery({
    queryKey: ['rpd-approvals-queue'],
    queryFn: getForwardedQueue,
  })

  const actMut = useMutation({
    mutationFn: (args: { submissionId: string; action: 'return' | 'approve'; comment?: string }) =>
      actOnForwardedSubmission(args.submissionId, args.action, args.comment),
    onSuccess: (_data, args) => {
      qc.invalidateQueries({ queryKey: ['rpd-approvals-queue'] })
      addToast(args.action === 'approve' ? 'РПД согласована' : 'Возвращено на доработку', 'success')
    },
    onError: () => addToast('Не удалось выполнить действие', 'error'),
  })

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-6 space-y-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Заявки на согласование</h1>
          <p className="text-xs font-sans text-ink-tertiary mt-1">
            РПД, принятые РОП и переданные на финальное согласование в УМЦ
          </p>
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-xs font-sans text-ink-tertiary">Загрузка…</div>
        ) : submissions.length === 0 ? (
          <p className="text-sm font-sans text-ink-secondary py-8 text-center">
            Нет заявок, ожидающих согласования.
          </p>
        ) : (
          <div className="space-y-3">
            {submissions.map((s) => (
              <ForwardedCard
                key={s.id}
                submission={s}
                busy={actMut.isPending}
                onAct={(submissionId, action, comment) => actMut.mutate({ submissionId, action, comment })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
