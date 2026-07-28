import { useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import TopBar from '../components/layout/TopBar'
import Button from '../components/ui/Button'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import SubmissionStatusBadge from '../components/rpd/SubmissionStatusBadge'
import { getMySyllabi, getMySubmission, submitSyllabusFile, submitSyllabusFromDraft, type MySyllabusItem } from '../api/mySyllabi'
import { useUIStore } from '../store/uiStore'

// Teacher-facing surface of the РПД approval route (docs/RPD-WORKFLOW.md
// phase 4b) — every discipline the teacher is responsible for, its current
// approval status, and both submission paths (§2.1): upload a finished file,
// or submit straight from a saved РПД-студия draft when the discipline has
// a linked предмет.

function fmtDate(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'
}

function DisciplineRow({ item }: { item: MySyllabusItem }) {
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)
  const fileRef = useRef<HTMLInputElement>(null)
  const [expanded, setExpanded] = useState(false)

  const { data: submission } = useQuery({
    queryKey: ['my-submission', item.discipline_id],
    queryFn: () => getMySubmission(item.discipline_id),
  })

  const uploadMut = useMutation({
    mutationFn: (file: File) => submitSyllabusFile(item.discipline_id, file),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission', item.discipline_id] })
      qc.invalidateQueries({ queryKey: ['my-syllabi'] })
      addToast('РПД отправлена на проверку', 'success')
    },
    onError: () => addToast('Не удалось отправить РПД', 'error'),
  })

  const draftMut = useMutation({
    mutationFn: () => submitSyllabusFromDraft(item.discipline_id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['my-submission', item.discipline_id] })
      qc.invalidateQueries({ queryKey: ['my-syllabi'] })
      addToast('Черновик отправлен на проверку', 'success')
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } }).response?.data?.error
      addToast(msg ?? 'Не удалось отправить черновик', 'error')
    },
  })

  const status = submission?.status ?? 'draft'
  const canSubmit = status === 'draft' || status === 'returned'
  const busy = uploadMut.isPending || draftMut.isPending

  // Only the return event carries a comment worth surfacing prominently —
  // that's the one moment the teacher needs to act on feedback, not just see history.
  const lastComment = [...(submission?.events ?? [])].reverse().find((e) => e.to_status === 'returned')?.comment

  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-sans text-sm font-medium text-ink">{item.discipline_name}</h3>
            <SubmissionStatusBadge status={status} />
          </div>
          <div className="text-xs font-sans text-ink-tertiary mt-1">
            {item.program_code && <span>{item.program_code} · </span>}
            {item.program_name} · Семестр {item.semester}
          </div>
        </div>
        {(submission?.events?.length ?? 0) > 0 && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs font-sans text-ink-secondary hover:text-ink transition-colors flex-shrink-0"
          >
            {expanded ? 'Скрыть историю' : 'История'}
          </button>
        )}
      </div>

      {status === 'returned' && lastComment && (
        <div className="mt-3 px-3 py-2.5 bg-warning-bg border border-warning/20 rounded-md">
          <span className="text-xs font-sans font-medium text-warning">Замечания: </span>
          <span className="text-xs font-sans text-ink">{lastComment}</span>
        </div>
      )}

      {expanded && submission?.events && submission.events.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border pt-3">
          {submission.events.map((e) => (
            <div key={e.id} className="text-xs font-sans text-ink-secondary">
              <span className="text-ink-tertiary">{fmtDate(e.created_at)}</span>
              {' — '}
              <SubmissionStatusBadge status={e.to_status} />
              {e.comment && <span className="ml-1.5 text-ink">{e.comment}</span>}
            </div>
          ))}
        </div>
      )}

      {canSubmit && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) uploadMut.mutate(file)
              e.target.value = ''
            }}
          />
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {uploadMut.isPending ? <LoadingSpinner size={13} /> : null}
            Загрузить файл
          </Button>
          {item.course_id && (
            <Button size="sm" disabled={busy} onClick={() => draftMut.mutate()}>
              {draftMut.isPending ? <LoadingSpinner size={13} /> : null}
              Отправить из РПД-студии
            </Button>
          )}
        </div>
      )}
    </div>
  )
}

export default function MySyllabi() {
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['my-syllabi'],
    queryFn: getMySyllabi,
  })

  return (
    <div className="flex-1 flex flex-col">
      <TopBar title="Мои РПД" subtitle="Дисциплины, за которые вы отвечаете" />
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-6 py-6 space-y-3">
          {isLoading ? (
            <div className="py-12 text-center text-xs font-sans text-ink-tertiary">Загрузка…</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="font-sans text-sm text-ink-secondary">
                Вы пока не назначены ответственным ни за одну дисциплину. Обратитесь к РОП вашей программы.
              </p>
            </div>
          ) : (
            items.map((item) => <DisciplineRow key={item.discipline_id} item={item} />)
          )}
        </div>
      </div>
    </div>
  )
}
