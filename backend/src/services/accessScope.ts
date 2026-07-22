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

export interface DomainGrant {
  level:        AccessLevel
  // Materialised paths of every unit this level was granted on for this
  // domain. Carried for Phase 3 (subtree query filtering) — Phase 1 callers
  // only check presence/level, not pathPrefixes.
  pathPrefixes: string[]
}

export type AccessScope = Partial<Record<Domain, DomainGrant>>

interface TeacherIdentity {
  id:                 string
  is_platform_admin:  boolean
  institution_id:     string | null
}

/** Resolve every domain a teacher has access to, and at what level. Single
 *  round trip (reuses listRoleScopesForTeacher). A grant with domain='all'
 *  applies to every concrete domain — this is what keeps every existing
 *  institution-root admin's access unchanged after the Phase 1 migration. */
export async function getAccessScope(teacher: TeacherIdentity): Promise<AccessScope> {
  if (teacher.is_platform_admin) {
    const grant: DomainGrant = { level: 'admin', pathPrefixes: ['/'] }
    return Object.fromEntries(DOMAINS.map((d) => [d, grant])) as AccessScope
  }
  if (!teacher.institution_id) return {}

  const rows = await listRoleScopesForTeacher(teacher.id)
  const scope: AccessScope = {}

  for (const row of rows) {
    const level = row.role as AccessLevel
    if (!(level in LEVEL_RANK)) continue // defensive: ignore unknown role values

    const domains: readonly Domain[] = row.domain === 'all' ? DOMAINS : [row.domain as Domain]
    for (const domain of domains) {
      const existing = scope[domain]
      if (!existing || LEVEL_RANK[level] > LEVEL_RANK[existing.level]) {
        scope[domain] = { level, pathPrefixes: [row.path] }
      } else if (LEVEL_RANK[level] === LEVEL_RANK[existing.level]) {
        existing.pathPrefixes.push(row.path)
      }
    }
  }

  return scope
}
