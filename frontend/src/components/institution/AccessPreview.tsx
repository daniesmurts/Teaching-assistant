import { useMemo, useState } from 'react'
import {
  evaluateAccess, accessDelta, nearMisses, programScope,
  FEATURE_CATALOG, SECTION_LABEL, DENY_REASON_LABEL,
  type HeldGrant, type FeatureVerdict, type FeatureSection, type ProgramScopeKind,
} from '../../../../shared/accessCatalog'
import type { OrgUnit, UnitRole, GrantDomain, InstitutionMember } from '../../api/orgStructure'

// Two answers to the same question, from one catalog (shared/accessCatalog.ts):
//
//   <GrantEffectPreview>  — "what will «Назначить» actually do?", shown inside
//                            the assign form before the grant is applied.
//   <MemberAccessPanel>   — "what does this person see today?", the after-the-
//                            fact view that no surface previously answered.
//
// Both are explanations, never gates: the server decides, this describes. The
// catalog is pinned to the real gate constants by
// backend/src/services/accessCatalog.test.ts.

/** Member roles + the unit index the page already loads → catalog grants.
 *  Roles pointing at a unit that is no longer in the tree are dropped (the
 *  server wouldn't resolve them either). */
export function toHeldGrants(
  roles:     InstitutionMember['roles'],
  unitsById: Map<string, OrgUnit>,
): HeldGrant[] {
  return roles.flatMap((r) => {
    const unit = unitsById.get(r.org_unit_id)
    if (!unit) return []
    return [{
      level:    r.role,
      domain:   r.domain,
      unitType: unit.type_code,
      unitId:   unit.id,
      unitName: unit.short_name || unit.name,
    }]
  })
}

export function pendingGrant(unit: OrgUnit, role: UnitRole, domain: GrantDomain): HeldGrant {
  return { level: role, domain, unitType: unit.type_code, unitId: unit.id, unitName: unit.short_name || unit.name }
}

const PROGRAM_SCOPE_LABEL: Record<ProgramScopeKind, string> = {
  'all-rw':   'все программы организации, с правом правки',
  'all-ro':   'все программы организации, только чтение',
  'specific': 'программы своего подразделения и всего, что под ним',
  'none':     'нет доступа',
}

/** «вся организация» vs the units the access is actually scoped to. */
function scopeLabel(v: FeatureVerdict): string {
  if (v.wide) return 'вся организация'
  const names = [...new Set(v.via.map((g) => g.unitName))]
  return names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} и ещё ${names.length - 2}`
}

const planNote = (v: FeatureVerdict) => (v.feature.plan === 'institution' ? ' · тариф «Организация»' : '')

const TickIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)

// The features no grant in the tree can ever open — listed once, so an admin
// stops looking for the role that would delegate them (CLAUDE.md §7: teacher
// provisioning and integration settings are centrally owned).
const ROOT_ONLY_LABELS = FEATURE_CATALOG.filter((f) => f.gate.kind === 'rootAdmin').map((f) => f.label)

// ─── In-form preview ──────────────────────────────────────────────────────────

export function GrantEffectPreview({ existing, pending }: { existing: HeldGrant[]; pending: HeldGrant }) {
  const { gained, already } = useMemo(
    () => accessDelta(existing, [...existing, pending]), [existing, pending]
  )
  const misses = useMemo(() => nearMisses(pending), [pending])
  const [showMisses, setShowMisses] = useState(false)

  const MAX = 7
  const shown = gained.slice(0, MAX)

  return (
    <div className="rounded-md border border-border bg-surface-warm px-2.5 py-2 space-y-1.5">
      <div className="text-[11px] font-sans font-medium text-ink">Что откроет эта роль</div>

      {gained.length === 0 ? (
        <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed">
          {already.length > 0
            ? 'Ничего нового — всё это уже открыто другими ролями преподавателя. Роль можно не выдавать.'
            : 'Ничего из панели «Организация». Эта комбинация не открывает ни одного раздела — проверьте область и тип подразделения.'}
        </p>
      ) : (
        <ul className="space-y-0.5">
          {shown.map((v) => (
            <li key={v.feature.key} className="flex items-start gap-1.5 text-[11px] font-sans text-ink-secondary leading-relaxed">
              <span className="text-success flex-shrink-0 mt-[3px]"><TickIcon /></span>
              <span>
                {v.feature.label}
                <span className="text-ink-tertiary"> — {scopeLabel(v)}{planNote(v)}</span>
              </span>
            </li>
          ))}
          {gained.length > MAX && (
            <li className="text-[11px] font-sans text-ink-tertiary pl-[18px]">и ещё {gained.length - MAX}</li>
          )}
        </ul>
      )}

      {already.length > 0 && gained.length > 0 && (
        <p className="text-[11px] font-sans text-ink-tertiary">
          Ещё {already.length} — уже открыто другими ролями преподавателя.
        </p>
      )}

      {misses.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowMisses((s) => !s)}
            className="text-[11px] font-sans text-ink-secondary hover:text-ink transition-colors underline decoration-dotted underline-offset-2"
          >
            {showMisses ? 'Скрыть' : `Не откроет (${misses.length})`}
          </button>
          {showMisses && (
            <ul className="mt-1 space-y-0.5">
              {misses.map((v) => (
                <li key={v.feature.key} className="text-[11px] font-sans text-ink-tertiary leading-relaxed pl-3">
                  · {v.feature.label} — {v.reason ? DENY_REASON_LABEL[v.reason] : '—'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed">
        Никакая роль не выдаёт: {ROOT_ONLY_LABELS.join(' · ')} — это остаётся за администратором организации.
      </p>
    </div>
  )
}

// ─── Person view ──────────────────────────────────────────────────────────────

const SECTION_ORDER: FeatureSection[] = ['org', 'umu', 'curriculum', 'programs', 'leadership', 'rootOnly']

export function MemberAccessPanel({ grants }: { grants: HeldGrant[] }) {
  const verdicts = useMemo(() => evaluateAccess(grants), [grants])
  const programs = useMemo(() => programScope(grants), [grants])
  const [showClosed, setShowClosed] = useState(false)

  const open   = verdicts.filter((v) => v.granted)
  const closed = verdicts.filter((v) => !v.granted)
  const isRootAdmin = grants.some((g) => g.level === 'admin' && g.domain === 'all' && g.unitType === 'institution')

  if (grants.length === 0) {
    return (
      <div className="rounded-md border border-border bg-surface-warm px-2.5 py-2">
        <p className="text-[11px] font-sans text-ink-tertiary leading-relaxed">
          Ролей нет — доступна только преподавательская часть приложения (свои предметы, проверка работ,
          материалы). Панель «Организация» и «Руководство» не открываются.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-surface-warm px-2.5 py-2 space-y-2">
      {isRootAdmin && (
        <p className="text-[11px] font-sans text-warning leading-relaxed">
          Администратор организации — полный доступ ко всем разделам и настройкам организации.
        </p>
      )}

      <div className="text-[11px] font-sans font-medium text-ink">Открыто ({open.length})</div>

      {SECTION_ORDER.map((section) => {
        const items = open.filter((v) => v.feature.section === section)
        if (items.length === 0) return null
        return (
          <div key={section} className="space-y-0.5">
            <div className="text-[10px] font-sans font-semibold text-ink-tertiary uppercase tracking-wider">
              {SECTION_LABEL[section]}
            </div>
            {items.map((v) => (
              <div key={v.feature.key} className="flex items-start gap-1.5 text-[11px] font-sans text-ink-secondary leading-relaxed">
                <span className="text-success flex-shrink-0 mt-[3px]"><TickIcon /></span>
                <span>
                  {v.feature.label}
                  <span className="text-ink-tertiary">
                    {' — '}
                    {v.feature.section === 'programs' ? PROGRAM_SCOPE_LABEL[programs] : scopeLabel(v)}
                    {planNote(v)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )
      })}

      {closed.length > 0 && (
        <div>
          <button
            type="button"
            onClick={() => setShowClosed((s) => !s)}
            className="text-[11px] font-sans text-ink-secondary hover:text-ink transition-colors underline decoration-dotted underline-offset-2"
          >
            {showClosed ? 'Скрыть закрытое' : `Закрыто (${closed.length})`}
          </button>
          {showClosed && (
            <ul className="mt-1 space-y-0.5">
              {closed.map((v) => (
                <li key={v.feature.key} className="text-[11px] font-sans text-ink-tertiary leading-relaxed pl-3">
                  · {v.feature.label} — {v.reason ? DENY_REASON_LABEL[v.reason] : '—'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
