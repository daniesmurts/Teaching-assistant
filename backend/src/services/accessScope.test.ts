import { describe, it, expect, vi } from 'vitest'
import { getAccessScope, levelAtLeast, resolveGrant, maxLevel } from './accessScope'
import * as orgUnitsQueries from '../db/queries/orgUnits'
import type { TeacherRoleScope } from '../db/queries/orgUnits'

function mockScopes(scopes: TeacherRoleScope[]) {
  vi.spyOn(orgUnitsQueries, 'listRoleScopesForTeacher').mockResolvedValue(scopes)
}

describe('levelAtLeast', () => {
  it('orders view < edit < admin', () => {
    expect(levelAtLeast('admin', 'view')).toBe(true)
    expect(levelAtLeast('edit', 'view')).toBe(true)
    expect(levelAtLeast('view', 'edit')).toBe(false)
    expect(levelAtLeast('edit', 'admin')).toBe(false)
    expect(levelAtLeast('view', 'view')).toBe(true)
  })
})

describe('getAccessScope', () => {
  it('grants the platform owner admin on every domain regardless of grants', async () => {
    mockScopes([])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: true, institution_id: null })
    expect(maxLevel(scope, 'platform')).toBe('admin')
    expect(maxLevel(scope, 'curriculum')).toBe('admin')
    expect(maxLevel(scope, 'teaching')).toBe('admin')
    expect(maxLevel(scope, 'umu')).toBe('admin')
  })

  it('returns empty scope for a teacher with no institution', async () => {
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: null })
    expect(scope).toEqual({})
  })

  it("expands a domain='all' admin grant (today's institution-root admin) across every domain", async () => {
    mockScopes([{ org_unit_id: 'root', role: 'admin', domain: 'all', path: '/inst/' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.platform).toEqual([{ level: 'admin', path: '/inst/' }])
    expect(scope.curriculum).toEqual([{ level: 'admin', path: '/inst/' }])
    expect(scope.teaching).toEqual([{ level: 'admin', path: '/inst/' }])
    expect(scope.umu).toEqual([{ level: 'admin', path: '/inst/' }])
  })

  it("a scoped domain='curriculum' edit grant reaches only curriculum", async () => {
    mockScopes([{ org_unit_id: 'umc', role: 'edit', domain: 'curriculum', path: '/inst/umc/' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.curriculum).toEqual([{ level: 'edit', path: '/inst/umc/' }])
    expect(scope.platform).toBeUndefined()
    expect(scope.teaching).toBeUndefined()
  })

  it('keeps every grant intact instead of collapsing to one level per domain', async () => {
    mockScopes([
      { org_unit_id: 'root', role: 'view', domain: 'curriculum', path: '/inst/' },
      { org_unit_id: 'umc',  role: 'edit', domain: 'curriculum', path: '/inst/umc/' },
    ])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.curriculum).toEqual([
      { level: 'view', path: '/inst/' },
      { level: 'edit', path: '/inst/umc/' },
    ])
  })

  it('ignores an unrecognised role value defensively', async () => {
    mockScopes([{ org_unit_id: 'x', role: 'bogus', domain: 'curriculum', path: '/inst/x/' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope).toEqual({})
  })
})

describe('resolveGrant', () => {
  // The multi-hat regression this whole change exists for: a Проректор
  // (view × teaching × root) who is ALSO a Заведующий кафедрой
  // (admin × teaching × кафедра). The old resolver let admin win and threw
  // the root path away, so subtree filtering narrowed them to their kafedra
  // and their university-wide oversight silently disappeared.
  const multiHat = {
    teaching: [
      { level: 'view'  as const, path: '/inst/' },
      { level: 'admin' as const, path: '/inst/div/kaf/' },
    ],
  }

  it('keeps the BROAD path on a view-level route even when a narrower admin grant exists', () => {
    const grant = resolveGrant(multiHat, 'teaching', 'view')
    expect(grant?.pathPrefixes).toContain('/inst/')
    expect(grant?.pathPrefixes).toContain('/inst/div/kaf/')
    expect(grant?.level).toBe('admin')   // highest held among qualifying grants
  })

  it('excludes paths of grants BELOW the required level', () => {
    const grant = resolveGrant(multiHat, 'teaching', 'admin')
    expect(grant?.pathPrefixes).toEqual(['/inst/div/kaf/'])
    expect(grant?.pathPrefixes).not.toContain('/inst/')
  })

  it('returns null when no grant reaches the required level', () => {
    expect(resolveGrant({ curriculum: [{ level: 'view', path: '/inst/' }] }, 'curriculum', 'edit')).toBeNull()
  })

  it('returns null for a domain with no grants at all', () => {
    expect(resolveGrant({}, 'umu', 'view')).toBeNull()
  })

  it('deduplicates repeated paths', () => {
    const grant = resolveGrant(
      { curriculum: [{ level: 'edit', path: '/inst/' }, { level: 'admin', path: '/inst/' }] },
      'curriculum', 'edit',
    )
    expect(grant?.pathPrefixes).toEqual(['/inst/'])
  })
})

describe('maxLevel', () => {
  it('reports the highest level held anywhere in the domain', () => {
    expect(maxLevel({ teaching: [{ level: 'view', path: '/a/' }, { level: 'admin', path: '/b/' }] }, 'teaching')).toBe('admin')
  })

  it('returns null for a domain with no grants', () => {
    expect(maxLevel({}, 'teaching')).toBeNull()
  })
})
