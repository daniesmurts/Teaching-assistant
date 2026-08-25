import type {
  AssessmentLinkageResult, AssessmentLinkageFinding, LinkageSlot, FosScoreCheck, FosScoreFinding,
  FosStructureCheck, BrsReadinessCheck,
} from '../../types'

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

      {result.brs_readiness && <BrsReadinessSection check={result.brs_readiness} />}

      {result.fos_structure?.checked && <FosStructureSection check={result.fos_structure} />}

      {result.fos_scores && <FosScoreSection check={result.fos_scores} />}

      {findings.length > 0 && (
        <div className="space-y-2.5">
          {findings.map((f, i) => <FindingCard key={i} finding={f} fosAvailable={fos_available} />)}
        </div>
      )}
    </div>
  )
}

const SCORE_KIND_LABEL: Record<FosScoreFinding['kind'], string> = {
  missing_in_fos:         'Нет в ФОС',
  missing_in_rpd:         'Нет в п.9',
  min_mismatch:           'Мин. балл',
  max_mismatch:           'Макс. балл',
  total_mismatch:         'Сумма за семестр',
  criteria_sum_mismatch:  'Критерии не сходятся',
  criteria_table_mismatch:'Критерии ≠ перечень',
}

// Which two things a finding is comparing — the side-by-side box would be
// mislabelled as «п.9 РПД / ФОС» for the criteria kinds, where both numbers
// come from inside the ФОС.
const SCORE_COMPARISON: Record<FosScoreFinding['kind'], { left: string; right: string } | null> = {
  missing_in_fos:          null,
  missing_in_rpd:          null,
  min_mismatch:            { left: 'п.9 РПД', right: 'ФОС' },
  max_mismatch:            { left: 'п.9 РПД', right: 'ФОС' },
  total_mismatch:          { left: 'п.9 РПД', right: 'ФОС' },
  criteria_sum_mismatch:   { left: 'Заявлено в критериях', right: 'Сумма составляющих' },
  criteria_table_mismatch: { left: 'В перечне ФОС', right: 'В критериях оценки' },
}

// «Баллы должны брать из п.9 РП» — the КНИТУ макет prints that rule under the
// ФОС's own score table. Arithmetic, so every finding shows both numbers side
// by side rather than asserting a mismatch the reader has to take on trust.
function FosScoreSection({ check }: { check: FosScoreCheck }) {
  if (!check.table_found) {
    return (
      <div className="rounded-lg border border-border bg-surface-warm px-3 py-2.5">
        <div className="text-xs font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1">
          Баллы ФОС ↔ п.9
        </div>
        <p className="text-xs font-sans text-ink-secondary leading-relaxed">{check.summary}</p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2.5 text-sm font-sans font-medium leading-relaxed ${
        check.findings.length === 0
          ? 'bg-success-bg border-success/30 text-success'
          : 'bg-warning-bg border-warning/30 text-warning'
      }`}>
        {check.summary}
      </div>

      {check.findings.map((f, i) => (
        <div key={i} className="bg-surface border border-border border-l-2 border-l-warning rounded-lg p-3">
          <div className="flex items-center gap-2 flex-wrap mb-1.5">
            <span className="text-[10px] font-sans font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-warning-bg text-warning">
              {SCORE_KIND_LABEL[f.kind]}
            </span>
            {f.instrument && (
              <span className="text-sm font-sans font-medium text-ink">{f.instrument}</span>
            )}
            {f.semester && (
              <span className="text-xs font-sans text-ink-tertiary">· {f.semester}</span>
            )}
          </div>

          {/* Both sides of the comparison, in tabular figures so the digits line up. */}
          {SCORE_COMPARISON[f.kind] && (
            <div className="flex flex-wrap gap-3 mb-1.5 text-xs font-sans">
              <span className="text-ink-secondary">
                {SCORE_COMPARISON[f.kind]!.left}: <span className="font-mono tabular-nums text-ink">
                  {f.rpd_min ?? '—'} / {f.rpd_max ?? '—'}
                </span>
              </span>
              <span className="text-ink-secondary">
                {SCORE_COMPARISON[f.kind]!.right}: <span className="font-mono tabular-nums text-ink">
                  {f.fos_min ?? '—'} / {f.fos_max ?? '—'}
                </span>
              </span>
            </div>
          )}

          <p className="text-xs font-sans text-ink-secondary leading-relaxed">{f.detail}</p>
          <p className="text-xs font-sans text-ink leading-relaxed mt-1">
            <span className="font-medium text-amber">Рекомендация: </span>{f.recommendation}
          </p>
        </div>
      ))}
    </div>
  )
}

// Structural conformance to КНИТУ's «Макет ФОС 3++» — deterministic section
// presence, so every finding names the block that is missing and what to put
// in it. Deliberately silent about section CONTENT: this check knows the
// «Шкала оценивания» heading exists, not whether its thresholds are right.
function FosStructureSection({ check }: { check: FosStructureCheck }) {
  const sections = check.findings.filter((f) => f.kind === 'missing_section')
  const criteria = check.findings.filter((f) => f.kind === 'missing_criteria')

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2.5 text-sm font-sans font-medium leading-relaxed ${
        check.findings.length === 0
          ? 'bg-success-bg border-success/30 text-success'
          : 'bg-warning-bg border-warning/30 text-warning'
      }`}>
        {check.summary}
      </div>

      {check.findings.length === 0 ? null : (
        <div className="bg-surface border border-border rounded-lg p-3 space-y-2.5">
          {sections.length > 0 && (
            <div>
              <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5">
                Не найдено разделов макета
              </div>
              <div className="space-y-2">
                {sections.map((f, i) => (
                  <div key={i}>
                    <p className="text-xs font-sans text-ink leading-relaxed">{f.detail}</p>
                    <p className="text-xs font-sans text-ink-secondary leading-relaxed mt-0.5">
                      <span className="font-medium text-amber">Как исправить: </span>{f.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {criteria.length > 0 && (
            <div className={sections.length > 0 ? 'pt-2.5 border-t border-border' : ''}>
              <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider mb-1.5">
                Оценочные средства без критериев оценки
              </div>
              <div className="space-y-2">
                {criteria.map((f, i) => (
                  <div key={i}>
                    <p className="text-xs font-sans text-ink leading-relaxed">{f.detail}</p>
                    <p className="text-xs font-sans text-ink-secondary leading-relaxed mt-0.5">
                      <span className="font-medium text-amber">Как исправить: </span>{f.recommendation}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// «Готов ли п.9 к сборке ФОС» — answered whether or not a ФОС exists yet,
// because its value is at authoring time. Errors block a conformant ФОС;
// warnings only mean the teacher will have to write something by hand.
function BrsReadinessSection({ check }: { check: BrsReadinessCheck }) {
  const errors = check.findings.filter((f) => f.severity === 'error')
  const rest   = check.findings.filter((f) => f.severity !== 'error')

  return (
    <div className="space-y-2">
      <div className={`rounded-lg border px-3 py-2.5 text-sm font-sans font-medium leading-relaxed ${
        !check.checked ? 'bg-surface-warm border-border text-ink-secondary'
          : check.ready && check.findings.length === 0
            ? 'bg-success-bg border-success/30 text-success'
            : check.ready ? 'bg-warning-bg border-warning/30 text-warning'
              : 'bg-danger-bg border-danger/30 text-danger'
      }`}>
        {check.summary}
      </div>

      {check.findings.length > 0 && (
        <div className="bg-surface border border-border rounded-lg p-3 space-y-2">
          {[...errors, ...rest].map((f, i) => (
            <div key={i} className={i > 0 ? 'pt-2 border-t border-border' : ''}>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`text-[10px] font-sans font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${
                  f.severity === 'error' ? 'bg-danger-bg text-danger' : 'bg-warning-bg text-warning'
                }`}>
                  {f.severity === 'error' ? 'Блокирует' : 'Замечание'}
                </span>
                {f.instrument && <span className="text-sm font-sans font-medium text-ink">{f.instrument}</span>}
                {f.semester && <span className="text-xs font-sans text-ink-tertiary">· {f.semester}</span>}
              </div>
              <p className="text-xs font-sans text-ink-secondary leading-relaxed">{f.detail}</p>
              <p className="text-xs font-sans text-ink leading-relaxed mt-0.5">
                <span className="font-medium text-amber">Рекомендация: </span>{f.recommendation}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
