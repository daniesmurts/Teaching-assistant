import { DOMAINS, type Domain, listRoleScopesForTeacher } from '../db/queries/orgUnits'

// Research.md §7.10 — the functional-authority axis, resolved alongside the
// existing subtree (§7.3) axis. A grant is (level) x (domain) x (subtree);
// this resolves "what can this teacher do, in which domains, where" in one
// shot per request. Mirrors services/programAccess.ts's shape (which predates
// this and stays a separate, richer resolver for the Programmes surface —
// its hardcoded unit-type rules are the seed-grant precedent this
// generalises, see §7.10.3).

export const ACCESS_LEVELS = ['view', 'edit', 'admin'] as const
export type AccessLevel = (typeof ACCESS_LEVELS)[number]

const LEVEL_RANK: Record<AccessLevel, number> = { view: 1, edit: 2, admin: 3 }

export function levelAtLeast(have: AccessLevel, need: AccessLevel): boolean {
  return LEVEL_RANK[have] >= LEVEL_RANK[need]
}

/** One held grant, kept intact. Levels are NOT collapsed across grants — see
 *  getAccessScope's contract below. */
export interface DomainGrantRow {
  level: AccessLevel
  path:  string    // materialised path of the unit the grant sits on
}

/** Every grant a teacher holds, grouped by domain. A domain-`all` grant is
 *  expanded into one row per concrete domain. */
export type AccessScope = Partial<Record<Domain, DomainGrantRow[]>>

/** The per-request resolved view for one (domain, minLevel) pair — what
 *  `requireDomain` hands downstream as `req.domainScope`. Shape unchanged
 *  from before the multi-grant fix, so path-filtering callers
 *  (routes/institution.ts, routes/orgUnits.ts) need no changes. */
export interface DomainGrant {
  level:        AccessLevel   // highest level held among the QUALIFYING grants
  pathPrefixes: string[]      // every unit path where the teacher meets minLevel
}

interface TeacherIdentity {
  id:                 string
  is_platform_admin:  boolean
  institution_id:     string | null
}

/**
 * Resolve every grant a teacher holds, per domain. Single round trip (reuses
 * listRoleScopesForTeacher). A grant with domain='all' applies to every
 * concrete domain — this is what keeps every existing institution-root
 * admin's access unchanged since the Phase 1 migration.
 *
 * **Grants are returned intact, never collapsed to one level per domain.**
 * That collapse was a real bug for multi-hat users: a Проректор holding
 * `view × teaching × root` who is *also* made Заведующий кафедрой
 * (`admin × teaching × кафедра`) had the higher level win AND the root path
 * discarded — so `resolveTeachingPrefixes` narrowed them to just their
 * kafedra and their university-wide oversight silently vanished. Gaining a
 * second role made them see strictly less. Callers now pick the grants that
 * satisfy the level they actually need (see resolveGrant).
 */
export async function getAccessScope(teacher: TeacherIdentity): Promise<AccessScope> {
  if (teacher.is_platform_admin) {
    return Object.fromEntries(
      DOMAINS.map((d) => [d, [{ level: 'admin' as AccessLevel, path: '/' }]])
    ) as AccessScope
  }
  if (!teacher.institution_id) return {}

  const rows = await listRoleScopesForTeacher(teacher.id)
  const scope: AccessScope = {}

  for (const row of rows) {
    const level = row.role as AccessLevel
    if (!(level in LEVEL_RANK)) continue // defensive: ignore unknown role values

    const domains: readonly Domain[] = row.domain === 'all' ? DOMAINS : [row.domain as Domain]
    for (const domain of domains) {
      ;(scope[domain] ??= []).push({ level, path: row.path })
    }
  }

  return scope
}

/**
 * Narrow a scope to the grants that actually satisfy `minLevel`, unioning
 * their paths. Returns null when the teacher doesn't reach `minLevel` in
 * this domain at all.
 *
 * Paths of grants BELOW minLevel are deliberately excluded: a route needing
 * `edit` must not have its subtree filter widened by a `view`-only grant
 * elsewhere in the tree.
 */
export function resolveGrant(
  scope:    AccessScope,
  domain:   Domain,
  minLevel: AccessLevel,
): DomainGrant | null {
  const qualifying = (scope[domain] ?? []).filter((g) => levelAtLeast(g.level, minLevel))
  if (qualifying.length === 0) return null
  const level = qualifying.reduce<AccessLevel>(
    (best, g) => (LEVEL_RANK[g.level] > LEVEL_RANK[best] ? g.level : best),
    qualifying[0].level,
  )
  return { level, pathPrefixes: [...new Set(qualifying.map((g) => g.path))] }
}

/** Highest level held in a domain, ignoring where. Powers the coarse
 *  `*_access` flags in the auth payload (frontend nav gating). */
export function maxLevel(scope: AccessScope, domain: Domain): AccessLevel | null {
  const grants = scope[domain] ?? []
  if (grants.length === 0) return null
  return grants.reduce<AccessLevel>(
    (best, g) => (LEVEL_RANK[g.level] > LEVEL_RANK[best] ? g.level : best),
    grants[0].level,
  )
}
