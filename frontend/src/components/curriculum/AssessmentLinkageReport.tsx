import type { AssessmentLinkageResult, AssessmentLinkageFinding, LinkageSlot } from '../../types'

// «Связка оценочного средства» — п.4 ↔ СРС ↔ КСР ↔ п.9 ↔ ФОС. Renders the
// chain per instrument as explicit links, so the методист sees WHICH link is
// broken at a glance instead of reading prose. The satisfied links show the
// phrase that satisfied them (same "show the evidence, don't assert it"
// contract the coverage citations follow). The ФОС link is drawn as
// genuinely unverified only when `result.fos_available` is false (no ФОС
// attached to this discipline) — when a ФОС was uploaded and searched, it
// gets a real ok/missing state like every other slot, never both at once.

const SLOT_LABEL: Record<LinkageSlot, string> = {
  srs: 'СРС', ksr: 'КСР', brs: 'п.9', fos: 'ФОС',
}
const SLOT_ORDER: LinkageSlot[] = ['srs', 'ksr', 'brs']

function LinkChip({ label, value, state }: {
  label: string
  value: string | null
  state: 'ok' | 'missing' | 'unverified' | 'not-required'
}) {
  const meta = {
    ok:             { cls: 'bg-success-bg text-success border-success/20', mark: '✓' },
    missing:        { cls: 'bg-danger-bg text-danger border-danger/20',    mark: '✕' },
    unverified:     { cls: 'bg-surface-warm text-ink-tertiary border-border', mark: '?' },
    'not-required': { cls: 'bg-surface-warm text-ink-tertiary border-border', mark: '—' },
  }[state]

  return (
    <div className={`flex-1 min-w-[110px] rounded-md border px-2.5 py-1.5 ${meta.cls}`}>
      <div className="flex items-center gap-1.5">
        <span className="text-[11px] font-sans font-semibold">{meta.mark}</span>
        <span className="text-[10px] font-sans font-semibold uppercase tracking-wider">{label}</span>
      </div>
      {value && <div className="text-[11px] font-sans mt-0.5 leading-snug opacity-90">«{value}»</div>}
      {state === 'unverified' && <div className="text-[11px] font-sans mt-0.5 leading-snug">не загружен</div>}
      {state === 'not-required' && <div className="text-[11px] font-sans mt-0.5 leading-snug">не требуется</div>}
    </div>
  )
}

function FindingCard({ finding, fosAvailable }: { finding: AssessmentLinkageFinding; fosAvailable: boolean }) {
  const matched: Record<LinkageSlot, string | null> = {
    srs: finding.matched_srs, ksr: finding.matched_ksr, brs: finding.matched_brs, fos: finding.matched_fos,
  }
  // A slot the instrument was never required to satisfy (промежуточная
  // аттестация skips СРС/КСР) is neither a pass nor a failure.
  const required = new Set<LinkageSlot>([
    ...finding.missing, ...SLOT_ORDER.filter((s) => matched[s]), ...(fosAvailable ? ['fos' as const] : []),
  ])

  return (
    <div className="bg-surface border border-border border-l-2 border-l-danger rounded-lg p-4">
      <div className="flex items-center gap-2 flex-wrap mb-2.5">
        <span className="text-sm font-sans font-medium text-ink">{finding.instrument}</span>
        {finding.section && <span className="text-xs font-sans text-ink-tertiary">· {finding.section}</span>}
        <span className="ml-auto text-[10px] font-sans font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-danger-bg text-danger">
          Связка нарушена
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 mb-3">
        <LinkChip label="п.4" value={finding.instrument} state="ok" />
        {SLOT_ORDER.map((slot) => (
          <LinkChip
            key={slot}
            label={SLOT_LABEL[slot]}
            value={matched[slot]}
            state={
              finding.missing.includes(slot) ? 'missing'
                : !required.has(slot) ? 'not-required'
                : slot === 'brs' && finding.brs_missing_points ? 'missing'
                : 'ok'
            }
          />
        ))}
        <LinkChip
          label="ФОС"
          value={matched.fos}
          state={
            !fosAvailable ? 'unverified'
              : finding.missing.includes('fos') ? 'missing'
              : 'ok'
          }
        />
      </div>

      <p className="text-xs font-sans text-ink-secondary leading-relaxed">{finding.detail}</p>
      <div className="mt-2.5 pt-2.5 border-t border-border">
        <p className="text-xs font-sans text-ink leading-relaxed">
          <span className="font-medium text-amber">Рекомендация: </span>{finding.recommendation}
        </p>
      </div>
    </div>
  )
}

export default function AssessmentLinkageReport({ result }: { result: AssessmentLinkageResult }) {
  const { parsed, findings, summary, fos_available } = result
  const instrumentCount = new Set(parsed.instruments.map((i) => i.name.toLowerCase())).size

  return (
    <div className="result-appear space-y-4">
      <div className={`rounded-lg border px-3 py-2.5 font-medium leading-relaxed text-sm font-sans ${
        findings.length === 0
          ? 'bg-success-bg border-success/30 text-success'
          : 'bg-warning-bg border-warning/30 text-warning'
      }`}>
        {summary}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs font-sans text-ink-secondary">
        <span>Оценочных средств в п.4: <span className="text-ink font-medium">{instrumentCount}</span></span>
        <span>Форм СРС: <span className="text-ink font-medium">{parsed.srs_forms.length}</span></span>
        <span>Форм КСР: <span className="text-ink font-medium">{parsed.ksr_forms.length}</span></span>
        <span>Точек в п.9: <span className="text-ink font-medium">{parsed.brs_items.length}</span></span>
        <span>ФОС: <span className="text-ink font-medium">{fos_available ? 'загружен' : 'не загружен'}</span></span>
      </div>

      {findings.length > 0 && (
        <div className="space-y-2.5">
          {findings.map((f, i) => <FindingCard key={i} finding={f} fosAvailable={fos_available} />)}
        </div>
      )}
    </div>
  )
}
