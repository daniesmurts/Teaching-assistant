import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import Button from '../components/ui/Button'
import { useUIStore } from '../store/uiStore'
import { getSubmission, gradeSubmission, type GradeSummary } from '../api/publishedAssignments'
import type { ProvenanceFacts } from '../types'

const GRADE_COLOR: Record<string, string> = {
  '5': 'var(--color-success)', '4': 'var(--color-amber)',
  '3': 'var(--color-warning)', '2': 'var(--color-danger)',
}

const fmtMinutes = (m: number) =>
  m >= 60 ? `${Math.floor(m / 60)} ч ${Math.round(m % 60)} мин` : `${m} мин`

const fmtDateTime = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'

export default function SubmissionReview() {
  const { id = '', inviteId = '' } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const addToast = useUIStore((s) => s.addToast)

  const { data, isLoading } = useQuery({
    queryKey: ['submission', id, inviteId],
    queryFn: () => getSubmission(id, inviteId),
  })

  const gradeMut = useMutation({
    mutationFn: () => gradeSubmission(id, inviteId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['submission', id, inviteId] })
      addToast('Работа проверена. Итоговая проверка — в Журнале.', 'success')
    },
    onError: (e: any) => addToast(e?.response?.data?.error ?? 'Не удалось проверить работу', 'error'),
  })

  if (isLoading || !data) {
    return <div className="flex-1 flex items-center justify-center text-sm font-sans text-ink-secondary">Загрузка…</div>
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6 page-enter">
        <button onClick={() => navigate(`/published/${id}`)}
          className="text-xs font-sans text-ink-secondary hover:text-ink mb-4">← К заданию</button>

        <h1 className="font-display text-2xl font-bold text-ink mb-1">
          {data.student_name || data.student_email || 'Работа студента'}
        </h1>
        <p className="text-sm font-sans text-ink-secondary mb-6">Сдано {fmtDateTime(data.submitted_at)}</p>

        <ProvenancePanel f={data.provenance} />

        {/* AI grade */}
        <div className="mt-6">
          <AiGradeSection
            grade={data.grade}
            grading={gradeMut.isPending}
            onGrade={() => gradeMut.mutate()}
            onOpenJournal={() => navigate('/history')}
          />
        </div>

        {/* Submission text */}
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2 mt-8">
          Текст работы
        </div>
        <div className="bg-surface-warm border border-border rounded-lg p-5 font-mono text-[13px] leading-[1.8] text-ink whitespace-pre-wrap">
          {data.submission_text || <span className="text-ink-tertiary font-sans">Пустая работа</span>}
        </div>
      </div>
    </div>
  )
}

// ─── Provenance report (§5.1.3) — transparent facts, no score ─────────────────

function observations(f: ProvenanceFacts): { tone: 'good' | 'note'; text: string }[] {
  const out: { tone: 'good' | 'note'; text: string }[] = []
  const pastePct = Math.round(f.pasteRatio * 100)

  if (f.totalChars > 0 && f.pastedChars === 0) {
    out.push({ tone: 'good', text: 'Текст набран вручную, без вставок.' })
  }
  if (f.pasteRatio >= 0.4) {
    out.push({ tone: 'note', text: `Вставкой введено ${pastePct}% текста.` })
  }
  if (f.largestPaste >= 500) {
    out.push({ tone: 'note', text: `Есть крупная единичная вставка — ${f.largestPaste} символов.` })
  }
  if (f.totalChars >= 1000 && f.activeMinutes > 0 && f.activeMinutes < 2) {
    out.push({ tone: 'note', text: 'Работа создана за очень короткое активное время.' })
  }
  if (f.revisionCount >= 80 && f.pasteRatio < 0.2) {
    out.push({ tone: 'good', text: 'Текст дорабатывался постепенно, много правок.' })
  }
  return out
}

function ProvenancePanel({ f }: { f: ProvenanceFacts }) {
  const obs = observations(f)
  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <div className="text-sm font-sans font-medium text-ink">Отчёт о процессе написания</div>
        <div className="text-xs font-sans text-ink-tertiary mt-0.5">
          Обобщённые показатели процесса. Это не оценка — решение остаётся за вами.
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-px bg-border">
        <Fact label="Активное время" value={fmtMinutes(f.activeMinutes)} />
        <Fact label="Всего по времени" value={fmtMinutes(f.spanMinutes)} />
        <Fact label="Правок" value={String(f.revisionCount)} />
        <Fact label="Объём" value={`${f.totalChars} симв.`} />
        <Fact label="Вставлено" value={`${f.pastedChars} симв. · ${Math.round(f.pasteRatio * 100)}%`} />
        <Fact label="Крупнейшая вставка" value={`${f.largestPaste} симв.`} />
      </div>

      {/* Paste ratio bar */}
      <div className="px-5 py-3 border-t border-border">
        <div className="flex items-center justify-between text-xs font-sans text-ink-secondary mb-1.5">
          <span>Доля вставленного текста</span>
          <span>{Math.round(f.pasteRatio * 100)}%</span>
        </div>
        <div className="h-1.5 bg-border rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700"
            style={{ width: `${Math.round(f.pasteRatio * 100)}%`,
                     backgroundColor: f.pasteRatio >= 0.4 ? 'var(--color-warning)' : 'var(--color-success)' }} />
        </div>
      </div>

      {obs.length > 0 && (
        <div className="px-5 py-3 border-t border-border space-y-1.5">
          {obs.map((o, i) => (
            <div key={i} className={`flex gap-1.5 text-xs font-sans leading-relaxed ${o.tone === 'good' ? 'text-success' : 'text-warning'}`}>
              <span className="flex-shrink-0">{o.tone === 'good' ? '✓' : '•'}</span><span>{o.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="text-[11px] font-sans text-ink-tertiary mb-1">{label}</div>
      <div className="text-sm font-sans font-medium text-ink">{value}</div>
    </div>
  )
}

// ─── AI grade (Q4b) ───────────────────────────────────────────────────────────

function AiGradeSection({ grade, grading, onGrade, onOpenJournal }: {
  grade: GradeSummary | null; grading: boolean; onGrade: () => void; onOpenJournal: () => void
}) {
  if (!grade) {
    return (
      <div className="flex items-center justify-between gap-3 bg-surface border border-border rounded-lg px-5 py-4">
        <div>
          <div className="text-sm font-sans font-medium text-ink">Черновая проверка</div>
          <div className="text-xs font-sans text-ink-tertiary mt-0.5">
            Получите предварительную оценку. Итоговую проверку и утверждение вы делаете в Журнале.
          </div>
        </div>
        <Button onClick={onGrade} loading={grading}>Проверить</Button>
      </div>
    )
  }

  return (
    <div className="bg-surface border border-border rounded-lg overflow-hidden">
      <div className="flex items-center gap-4 px-5 py-4 border-b border-border">
        <div className="font-display text-4xl font-bold leading-none"
          style={{ color: GRADE_COLOR[grade.ai_grade ?? ''] ?? 'var(--color-ink)' }}>
          {grade.ai_grade ?? '—'}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-sans font-medium text-ink">{grade.ai_grade_label ?? 'Предварительная оценка'}</div>
          {grade.ai_score != null && <div className="text-xs font-sans text-ink-tertiary">{grade.ai_score} баллов</div>}
        </div>
        <button onClick={onOpenJournal}
          className="ml-auto text-xs font-sans font-medium text-amber hover:opacity-80 flex-shrink-0">
          Проверить и утвердить в Журнале →
        </button>
      </div>

      {grade.ai_feedback && (
        <div className="px-5 py-4 text-sm font-sans text-ink leading-relaxed whitespace-pre-wrap border-b border-border">
          {grade.ai_feedback}
        </div>
      )}

      {(grade.ai_strengths.length > 0 || grade.ai_improvements.length > 0) && (
        <div className="grid grid-cols-2 gap-2.5 p-4">
          <div className="bg-success-bg border border-success/15 rounded-lg p-3">
            <div className="text-xs font-semibold text-success uppercase tracking-wide mb-2">Сильные стороны</div>
            {grade.ai_strengths.map((s, i) => (
              <div key={i} className="flex gap-1.5 text-xs text-success mb-1 leading-relaxed">
                <span className="flex-shrink-0">·</span><span>{s}</span>
              </div>
            ))}
          </div>
          <div className="bg-warning-bg border border-warning/15 rounded-lg p-3">
            <div className="text-xs font-semibold text-warning uppercase tracking-wide mb-2">Над чем поработать</div>
            {grade.ai_improvements.map((s, i) => (
              <div key={i} className="flex gap-1.5 text-xs text-warning mb-1 leading-relaxed">
                <span className="flex-shrink-0">·</span><span>{s}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
