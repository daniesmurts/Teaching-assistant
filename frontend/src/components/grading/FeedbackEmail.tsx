import { useState } from 'react'
import Button from '../ui/Button'
import { useGenerateEmail } from '../../hooks/useGrading'

type Tone = 'encouraging' | 'neutral' | 'direct'

const TONES: { value: Tone; label: string }[] = [
  { value: 'encouraging', label: 'Encouraging' },
  { value: 'neutral',     label: 'Neutral'      },
  { value: 'direct',      label: 'Direct'        },
]

export default function FeedbackEmail({ assignmentId }: { assignmentId: string }) {
  const [tone, setTone]   = useState<Tone>('neutral')
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const emailMut = useGenerateEmail(assignmentId)

  function generate() {
    emailMut.mutate(tone, { onSuccess: setDraft })
  }

  function copyAll() {
    if (!draft) return
    navigator.clipboard.writeText(`Subject: ${draft.subject}\n\n${draft.body}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-2">
          Tone
        </div>
        <div className="flex gap-2">
          {TONES.map((t) => (
            <button
              key={t.value}
              onClick={() => setTone(t.value)}
              className={`px-3 py-1.5 text-xs font-sans rounded-md border transition-colors ${
                tone === t.value
                  ? 'border-amber bg-amber-light text-amber'
                  : 'border-border text-ink-secondary hover:bg-surface-warm'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Button onClick={generate} loading={emailMut.isPending} variant="secondary">
        Generate draft email
      </Button>

      {draft && (
        <div className="space-y-3">
          <div>
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1">Subject</div>
            <div className="px-3 py-2 bg-surface-warm border border-border rounded-md text-sm font-sans text-ink">
              {draft.subject}
            </div>
          </div>
          <div>
            <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1">Body</div>
            <pre className="px-3 py-2 bg-surface-warm border border-border rounded-md text-sm font-sans text-ink whitespace-pre-wrap leading-relaxed">
              {draft.body}
            </pre>
          </div>
          <Button size="sm" variant="secondary" onClick={copyAll}>
            {copied ? '✓ Copied!' : 'Copy to clipboard'}
          </Button>
        </div>
      )}
    </div>
  )
}
