// Machine-readable mirror of docs/ACCESS-MATRIX.md Table B — every feature an
// org-tree grant can open, and the gate that opens it.
//
// **Why this exists as data:** an org admin picking (подразделение × роль ×
// область) in the role-assign form cannot tell from those three dropdowns what
// the combination actually unlocks, and the same question ("what does this
// person actually see?") had no answer anywhere in the product. Both surfaces
// read this one catalog, so they can't disagree with each other.
//
// **What this is NOT:** an authorisation decision. Nothing here gates anything
// — the real gates are `middleware/requireDomain.ts` +
// `services/accessScope.ts` on the server. This is an explanation of them, and
// the evaluator below deliberately replicates their resolution rules
// (domain='all' expansion, level ranking, the institution-root escape hatch in
// `resolveGrantOnUnitTypes`, and `getProgramAccessScope`'s unit-type rules).
// `backend/src/services/accessCatalog.test.ts` pins the unit-type lists against
// the constants the real gates use, so a change on one side fails the build
// rather than silently making this page lie.

export const ACCESS_DOMAINS = ['platform', 'curriculum', 'teaching', 'umu'] as const
export type AccessDomain = (typeof ACCESS_DOMAINS)[number]

/** What a grant carries in the UI/db — 'all' is the grant-time wildcard. */
export type GrantDomainValue = AccessDomain | 'all'

export const ACCESS_LEVELS = ['view', 'edit', 'admin'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

export type CatalogUnitType =
  | 'institution' | 'governance' | 'admin_office'
  | 'cluster' | 'division' | 'ugsn' | 'program_direction' | 'program' | 'department'

const LEVEL_RANK: Record<AccessLevel, number> = { view: 1, edit: 2, admin: 3 }

export function levelAtLeast(have: AccessLevel, need: AccessLevel): boolean {
  return LEVEL_RANK[have] >= LEVEL_RANK[need]
}

/** One grant a teacher holds, in the shape both callers already have to hand
 *  (the assign form's pending selection; a member row's existing roles joined
 *  to the unit). `unitName` is display-only. */
export interface HeldGrant {
  level:     AccessLevel
  domain:    GrantDomainValue
  unitType:  CatalogUnitType
  unitId:    string
  unitName:  string
}

// ─── Unit-type policies ───────────────────────────────────────────────────────
// Mirrors of backend/src/services/accessScope.ts. Kept as separate named
// constants (not one shared list) for the same reason the backend does: the
// policies are independent and may diverge even while the values match.

/** «Критерии»/«Рубрики» — reading. */
export const CRITERIA_READ_UNIT_TYPES:   readonly CatalogUnitType[] = ['governance', 'division', 'department']
/** «Критерии»/«Рубрики» — creating. */
export const CRITERIA_CREATE_UNIT_TYPES: readonly CatalogUnitType[] = ['division', 'department']
/** «Обзор»/«Использование»/«Преподаватели» — institution-oversight surfaces. */
export const TEACHING_OVERVIEW_UNIT_TYPES: readonly CatalogUnitType[] = ['governance', 'division', 'department']
/** «Кабинет методиста» — the УМУ/УМЦ office family. */
export const METHODIST_UNIT_TYPES: readonly CatalogUnitType[] = ['admin_office']

/** Unit types whose curriculum grant confers institution-WIDE programme access
 *  regardless of subtree (services/programAccess.ts). */
export const INSTITUTION_WIDE_PROGRAM_TYPES: readonly CatalogUnitType[] = ['governance', 'admin_office']

// ─── The catalog ──────────────────────────────────────────────────────────────

export type FeatureGate =
  /** `requireDomain` / `requireDomainOnUnitTypes`. */
  | { kind: 'domain'; domain: AccessDomain; minLevel: AccessLevel; unitTypes?: readonly CatalogUnitType[] }
  /** Never delegated to a subtree grant — institution-root admin only. */
  | { kind: 'rootAdmin' }
  /** «Образовательные программы» — resolved from unit TYPE, not from the
   *  domain bundle (docs/ACCESS-MATRIX.md §5). */
  | { kind: 'programs'; write: boolean }

export type FeatureSection = 'org' | 'umu' | 'curriculum' | 'programs' | 'leadership' | 'rootOnly'

export const SECTION_LABEL: Record<FeatureSection, string> = {
  org:        'Панель «Организация»',
  umu:        'Учебно-методическое управление',
  curriculum: 'Критерии и рубрики',
  programs:   'Образовательные программы',
  leadership: 'Руководство',
  rootOnly:   'Только администратор организации',
}

export interface FeatureEntry {
  key:      string
  label:    string
  section:  FeatureSection
  gate:     FeatureGate
  /** In-app route, when the feature is a page. */
  path?:    string
  /** Tariff requirement — informational only; this module never evaluates it. */
  plan?:    'institution'
  /** One line an admin needs in order not to be surprised. */
  note?:    string
}

export const FEATURE_CATALOG: readonly FeatureEntry[] = [
  // ── Панель «Организация» ────────────────────────────────────────────────────
  {
    key: 'overview', label: 'Обзор организации', section: 'org', path: '/institution',
    gate: { kind: 'domain', domain: 'teaching', minLevel: 'view', unitTypes: TEACHING_OVERVIEW_UNIT_TYPES },
    note: 'Роль на программе или полигруппе сюда не ведёт — только на институте, кафедре или органе управления.',
  },
  {
    key: 'usage', label: 'Использование', section: 'org', path: '/institution/usage',
    gate: { kind: 'domain', domain: 'teaching', minLevel: 'view', unitTypes: TEACHING_OVERVIEW_UNIT_TYPES },
  },
  {
    key: 'teachersRead', label: 'Преподаватели — просмотр', section: 'org', path: '/institution/teachers',
    gate: { kind: 'domain', domain: 'teaching', minLevel: 'view', unitTypes: TEACHING_OVERVIEW_UNIT_TYPES },
  },
  {
    key: 'structure', label: 'Структура организации — изменение', section: 'org', path: '/institution/structure',
    gate: { kind: 'domain', domain: 'platform', minLevel: 'admin' },
    note: 'Даёт право менять дерево и выдавать роли в пределах своего поддерева.',
  },
  {
    key: 'strategy', label: 'Стратегия развития', section: 'org', path: '/institution/strategy-document',
    gate: { kind: 'domain', domain: 'platform', minLevel: 'edit' },
  },

  // ── УМУ ─────────────────────────────────────────────────────────────────────
  {
    key: 'methodist', label: 'Кабинет методиста', section: 'umu', path: '/institution/methodist',
    gate: { kind: 'domain', domain: 'curriculum', minLevel: 'view', unitTypes: METHODIST_UNIT_TYPES },
    note: 'Открывается ролью на управлении/центре (например, УМЦ), а не на кафедре или программе.',
  },
  {
    key: 'rpdMonitorRead', label: 'Мониторинг РПД — просмотр', section: 'umu', path: '/institution/rpd', plan: 'institution',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'view' },
    note: 'Область «УМУ» выделена отдельно именно для этого: заведующий кафедрой ведёт критерии, но не видит сводку по филиалу.',
  },
  {
    key: 'rpdMonitorEdit', label: 'Мониторинг РПД — загрузка и письма', section: 'umu', path: '/institution/rpd', plan: 'institution',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'edit' },
  },
  {
    key: 'umcReadiness', label: 'Готовность УМК', section: 'umu', path: '/institution/umc', plan: 'institution',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'view' },
  },
  {
    key: 'rpdApprovalsRead', label: 'Согласование РПД — просмотр', section: 'umu', path: '/institution/rpd-approvals',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'view' },
  },
  {
    key: 'rpdApprovalsAct', label: 'Согласование РПД — решения', section: 'umu', path: '/institution/rpd-approvals',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'edit' },
  },
  {
    key: 'libraryRead', label: 'Библиотека кафедры — просмотр', section: 'umu', path: '/institution/library',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'view' },
  },
  {
    key: 'libraryPromote', label: 'Библиотека — продвижение документа на подразделение', section: 'umu',
    gate: { kind: 'domain', domain: 'umu', minLevel: 'edit' },
    note: 'Продвижение на всю организацию — только ролью на корне организации.',
  },

  // ── Критерии и рубрики ──────────────────────────────────────────────────────
  {
    key: 'criteriaRead', label: 'Критерии и рубрики — просмотр', section: 'curriculum', path: '/institution/rubrics',
    gate: { kind: 'domain', domain: 'curriculum', minLevel: 'view', unitTypes: CRITERIA_READ_UNIT_TYPES },
  },
  {
    key: 'criteriaCreate', label: 'Критерии и рубрики — создание', section: 'curriculum', path: '/institution/rubrics',
    gate: { kind: 'domain', domain: 'curriculum', minLevel: 'edit', unitTypes: CRITERIA_CREATE_UNIT_TYPES },
    note: 'Институтская курация: роль на кафедре или институте. Руководитель ОП критерии не создаёт.',
  },

  // ── Программы ───────────────────────────────────────────────────────────────
  {
    key: 'programsRead', label: 'Образовательные программы — просмотр', section: 'programs', path: '/programs',
    gate: { kind: 'programs', write: false },
  },
  {
    key: 'programsWrite', label: 'Образовательные программы — импорт и правка', section: 'programs', path: '/programs',
    gate: { kind: 'programs', write: true },
  },

  // ── Руководство ─────────────────────────────────────────────────────────────
  {
    key: 'leadershipSummary', label: 'Сводка по подразделению', section: 'leadership', path: '/leadership',
    gate: { kind: 'domain', domain: 'teaching', minLevel: 'view' },
    note: 'В отличие от «Обзора», работает на подразделении любого типа — включая программу и полигруппу.',
  },
  {
    key: 'leadershipTeacher', label: 'Карточка преподавателя', section: 'leadership',
    gate: { kind: 'domain', domain: 'teaching', minLevel: 'view' },
  },

  // ── Только администратор организации ────────────────────────────────────────
  // Permanently root-admin-only (CLAUDE.md §7 / TODO Feature P(c)): teacher
  // provisioning and integration settings are centrally owned by IT, never
  // delegated per subtree. Listed so an admin stops hunting for the role that
  // would grant them.
  {
    key: 'teachersInvite', label: 'Приглашение и деактивация преподавателей', section: 'rootOnly',
    gate: { kind: 'rootAdmin' }, note: 'Заведение сотрудников остаётся за центральной службой.',
  },
  { key: 'primaryUnit',  label: 'Назначение основной кафедры',  section: 'rootOnly', gate: { kind: 'rootAdmin' } },
  { key: 'sharedRag',    label: 'Общий цикл',      section: 'rootOnly', path: '/institution/shared-rag',  gate: { kind: 'rootAdmin' } },
  { key: 'model',        label: 'Модель',          section: 'rootOnly', path: '/institution/model',       gate: { kind: 'rootAdmin' } },
  { key: 'lti',          label: 'LTI / LMS',       section: 'rootOnly', path: '/institution/lti',         gate: { kind: 'rootAdmin' } },
  { key: 'branding',     label: 'Фирменный стиль', section: 'rootOnly', path: '/institution/branding',    gate: { kind: 'rootAdmin' } },
  { key: 'audit',        label: 'Журнал действий', section: 'rootOnly', path: '/institution/audit',       gate: { kind: 'rootAdmin' } },
]

// ─── Evaluation ───────────────────────────────────────────────────────────────

/** Why a feature stayed closed — drives the «не откроет, потому что» copy. */
export type DenyReason =
  | 'domain'     // no grant in this область at all
  | 'level'      // right область, level too low
  | 'unitType'   // right область and level, wrong kind of подразделение
  | 'rootAdmin'  // never grantable via the tree

export interface FeatureVerdict {
  feature: FeatureEntry
  granted: boolean
  /** Grants that actually open it — [] when denied. */
  via:     HeldGrant[]
  /** True when at least one opening grant sits on the institution root, i.e.
   *  the access is organisation-wide rather than subtree-scoped. */
  wide:    boolean
  reason?: DenyReason
}

/** Every concrete domain a grant covers — 'all' expands, mirroring
 *  `getAccessScope`. */
export function grantDomains(domain: GrantDomainValue): readonly AccessDomain[] {
  return domain === 'all' ? ACCESS_DOMAINS : [domain]
}

/** Institution-root admin — the only grant that is genuinely organisation-wide
 *  on every axis (`isInstitutionAdmin`; the server rejects admin+all anywhere
 *  but the root). */
export function isRootAdminGrant(g: HeldGrant): boolean {
  return g.level === 'admin' && g.domain === 'all' && g.unitType === 'institution'
}

/** `getProgramAccessScope`'s resolution, minus the subtree walk (the client
 *  has no need to enumerate programme unit ids — 'specific' is displayed as
 *  "программы своего поддерева"). */
export type ProgramScopeKind = 'all-rw' | 'all-ro' | 'specific' | 'none'

export function programScope(grants: readonly HeldGrant[]): ProgramScopeKind {
  // Only 'all' and 'curriculum' grants reach programmes — a teaching- or
  // umu-only grant must never unlock programme editing.
  const relevant = grants.filter((g) => g.domain === 'all' || g.domain === 'curriculum')
  if (relevant.length === 0) return 'none'
  const writable = relevant.filter((g) => g.level === 'admin' || g.level === 'edit')

  if (writable.some((g) => g.level === 'admin' && g.unitType === 'institution')) return 'all-rw'
  if (writable.some((g) => INSTITUTION_WIDE_PROGRAM_TYPES.includes(g.unitType)))  return 'all-rw'
  if (relevant.some((g) => INSTITUTION_WIDE_PROGRAM_TYPES.includes(g.unitType) || g.unitType === 'institution')) return 'all-ro'
  return 'specific'
}

function domainGateVerdict(
  grants: readonly HeldGrant[],
  gate:   Extract<FeatureGate, { kind: 'domain' }>,
): { via: HeldGrant[]; reason?: DenyReason } {
  const inDomain = grants.filter((g) => grantDomains(g.domain).includes(gate.domain))
  if (inDomain.length === 0) return { via: [], reason: 'domain' }

  const atLevel = inDomain.filter((g) => levelAtLeast(g.level, gate.minLevel))
  if (atLevel.length === 0) return { via: [], reason: 'level' }

  // A grant on the institution root always qualifies regardless of the
  // unit-type policy — resolveGrantOnUnitTypes's escape hatch, so root admin
  // is never narrower than a rule aimed at everyone else.
  const via = gate.unitTypes
    ? atLevel.filter((g) => g.unitType === 'institution' || gate.unitTypes!.includes(g.unitType))
    : atLevel
  if (via.length === 0) return { via: [], reason: 'unitType' }
  return { via }
}

/** Resolve the whole catalog against a set of held grants. Pure. */
export function evaluateAccess(grants: readonly HeldGrant[]): FeatureVerdict[] {
  const rootAdmins = grants.filter(isRootAdminGrant)
  const programs   = programScope(grants)

  return FEATURE_CATALOG.map((feature): FeatureVerdict => {
    if (feature.gate.kind === 'rootAdmin') {
      return rootAdmins.length > 0
        ? { feature, granted: true, via: rootAdmins, wide: true }
        : { feature, granted: false, via: [], wide: false, reason: 'rootAdmin' }
    }

    if (feature.gate.kind === 'programs') {
      const write   = feature.gate.write
      const granted = write ? programs === 'all-rw' || programs === 'specific'
                            : programs !== 'none'
      // Editable subset of a 'specific' scope needs an edit-or-better grant.
      const via = grants.filter((g) =>
        (g.domain === 'all' || g.domain === 'curriculum') &&
        (!write || g.level === 'admin' || g.level === 'edit'))
      if (!granted || via.length === 0) {
        return { feature, granted: false, via: [], wide: false, reason: write && programs !== 'none' ? 'level' : 'domain' }
      }
      return { feature, granted: true, via, wide: programs === 'all-rw' || programs === 'all-ro' }
    }

    const { via, reason } = domainGateVerdict(grants, feature.gate)
    if (via.length === 0) return { feature, granted: false, via: [], wide: false, reason }
    return { feature, granted: true, via, wide: via.some((g) => g.unitType === 'institution') }
  })
}

/** Features `next` opens that `current` did not — the incremental effect of
 *  adding one grant, which is what the assign form needs to show. */
export function accessDelta(
  current: readonly HeldGrant[],
  next:    readonly HeldGrant[],
): { gained: FeatureVerdict[]; already: FeatureVerdict[] } {
  const before = new Map(evaluateAccess(current).map((v) => [v.feature.key, v.granted]))
  const after  = evaluateAccess(next)
  const gained  = after.filter((v) => v.granted && !before.get(v.feature.key))
  const already = after.filter((v) => v.granted && before.get(v.feature.key))
  return { gained, already }
}

/** The near-misses worth showing next to a pending grant: features in the
 *  области this grant touches that it still does NOT open, with the reason.
 *  Root-admin-only entries are excluded — they are never a near miss, and the
 *  UI lists them separately as a permanent exclusion. */
export function nearMisses(grant: HeldGrant): FeatureVerdict[] {
  const domains = grantDomains(grant.domain)
  return evaluateAccess([grant]).filter((v) =>
    !v.granted &&
    v.feature.gate.kind === 'domain' &&
    domains.includes(v.feature.gate.domain) &&
    (v.reason === 'level' || v.reason === 'unitType'))
}

export const DENY_REASON_LABEL: Record<DenyReason, string> = {
  domain:   'другая область',
  level:    'нужен более высокий уровень роли',
  unitType: 'нужна роль на подразделении другого типа',
  rootAdmin: 'только администратор организации',
}
