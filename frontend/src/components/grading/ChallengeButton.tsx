import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { submitChallenge } from '../../api/challenges'
import { usePlan } from '../../hooks/usePlan'
import { useUIStore } from '../../store/uiStore'
import type { ChallengeSourceType, ChallengeResult } from '../../types'

const VERDICT_META: Record<ChallengeResult['verdict'], { label: string; cls: string }> = {
  confirm: { label: 'Подтверждено', cls: 'bg-success-bg text-success' },
  clarify: { label: 'Уточнено',     cls: 'bg-amber-light text-amber' },
  retract: { label: 'Отозвано',     cls: 'bg-danger-bg text-danger' },
}

interface Props {
  sourceType:    ChallengeSourceType
  claimText:     string
  claimQuote?:   string | null
  sourceText:    string
  assignmentId?: string | null
  itemRef?:      string | null
  // Called when the teacher accepts the model's rewrite/retraction, so the
  // host can update the underlying bullet/finding text in place.
  onApply?: (suggestedText: string | null, verdict: ChallengeResult['verdict']) => void
  onCite?:  (quote: string) => void
}

/**
 * "Оспорить" — inline, per-item challenge trigger. Deliberately anchored to
 * a single feedback item (bullet / criterion comment / coverage finding)
 * rather than an arbitrary text selection: every item here already carries
 * its own citation contract (quote + source), so there's no ambiguity about
 * what's being re-verified or against what.
 */
export default function ChallengeButton({
  sourceType, claimText, claimQuote, sourceText, assignmentId, itemRef, onApply, onCite,
}: Props) {
  const { can } = usePlan()
  const showUpgradeModal = useUIStore((s) => s.showUpgradeModal)
  const enabled = can('challengeFeedback')

  const [open, setOpen]           = useState(false)
  const [objection, setObjection] = useState('')
  const [result, setResult]       = useState<ChallengeResult | null>(null)

  const mut = useMutation({
    mutationFn: () => submitChallenge({
      source_type:   sourceType,
      assignment_id: assignmentId ?? null,
      item_ref:      itemRef ?? null,
      claim_text:    claimText,
      claim_quote:   claimQuote ?? null,
      source_text:   sourceText,
      objection,
    }),
    onSuccess: setResult,
    onError: () => { /* interceptor shows the toast (incl. plan-upgrade modal on 403) */ },
  })

  function toggle() {
    if (!enabled) { showUpgradeModal('FEATURE_NOT_IN_PLAN'); return }
    setOpen((o) => !o)
  }

  if (!open && !result) {
    return (
      <button
        type="button"
        onClick={toggle}
        className="mt-1 inline-flex items-center gap-1 text-xs font-sans font-semibold text-info hover:text-info/80 transition-colors"
      >
        <span aria-hidden>⚑</span> Оспорить{!enabled && ' · Pro'}
      </button>
    )
  }

  if (result) {
    const meta = VERDICT_META[result.verdict]
    return (
      <div className="mt-1.5 border-l-2 border-info/40 pl-2.5 space-y-1.5">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-sans font-medium px-1.5 py-0.5 rounded-sm ${meta.cls}`}>{meta.label}</span>
          <button
            type="button"
            onClick={() => { setResult(null); setOpen(false); setObjection('') }}
            className="text-xs font-sans text-ink-tertiary hover:text-ink"
          >
            Закрыть
          </button>
        </div>
        <p className="text-sm font-sans text-ink-secondary leading-relaxed">{result.explanation}</p>
        {result.evidence_quote && (
          <button
            type="button"
            onClick={() => onCite?.(result.evidence_quote!)}
            className="block text-left text-xs font-sans italic text-ink-secondary hover:text-ink"
          >
            «{result.evidence_quote}»
          </button>
        )}
        {result.verdict !== 'confirm' && onApply && (
          <button
            type="button"
            onClick={() => { onApply(result.suggested_text, result.verdict); setResult(null); setOpen(false); setObjection('') }}
            className="text-xs font-sans font-semibold text-info hover:underline"
          >
            {result.verdict === 'retract' && !result.suggested_text ? 'Убрать пункт' : 'Применить формулировку'}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="mt-1.5 border-l-2 border-info/40 pl-2.5 space-y-1.5">
      <textarea
        autoFocus
        rows={2}
        value={objection}
        onChange={(e) => setObjection(e.target.value)}
        placeholder="В чём проблема? Например: это верно, а не отмечено как ошибка."
        className="w-full px-2 py-1.5 text-sm font-sans bg-surface border border-border rounded-md resize-y focus:outline-none focus:border-border-strong"
        maxLength={1200}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={objection.trim().length < 3 || mut.isPending}
          onClick={() => mut.mutate()}
          className="text-xs font-sans font-semibold text-info hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {mut.isPending ? 'Проверяем…' : 'Отправить'}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setObjection('') }}
          className="text-xs font-sans text-ink-tertiary hover:text-ink"
        >
          Отмена
        </button>
      </div>
    </div>
  )
}
