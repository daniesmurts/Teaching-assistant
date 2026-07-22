import { describe, it, expect, vi } from 'vitest'
import { getAccessScope, levelAtLeast } from './accessScope'
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
    expect(scope.platform?.level).toBe('admin')
    expect(scope.curriculum?.level).toBe('admin')
    expect(scope.teaching?.level).toBe('admin')
  })

  it('returns empty scope for a teacher with no institution', async () => {
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: null })
    expect(scope).toEqual({})
  })

  it("expands a domain='all' admin grant (today's institution-root admin) across every domain", async () => {
    mockScopes([{ org_unit_id: 'root', role: 'admin', domain: 'all', path: '/inst/' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.platform).toEqual({ level: 'admin', pathPrefixes: ['/inst/'] })
    expect(scope.curriculum).toEqual({ level: 'admin', pathPrefixes: ['/inst/'] })
    expect(scope.teaching).toEqual({ level: 'admin', pathPrefixes: ['/inst/'] })
  })

  it("a scoped domain='curriculum' edit grant reaches only curriculum", async () => {
    mockScopes([{ org_unit_id: 'umc', role: 'edit', domain: 'curriculum', path: '/inst/umc/' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.curriculum).toEqual({ level: 'edit', pathPrefixes: ['/inst/umc/'] })
    expect(scope.platform).toBeUndefined()
    expect(scope.teaching).toBeUndefined()
  })

  it('keeps the highest level per domain when grants overlap', async () => {
    mockScopes([
      { org_unit_id: 'root', role: 'view', domain: 'curriculum', path: '/inst/' },
      { org_unit_id: 'umc',  role: 'edit', domain: 'curriculum', path: '/inst/umc/' },
    ])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.curriculum?.level).toBe('edit')
    expect(scope.curriculum?.pathPrefixes).toEqual(['/inst/umc/'])
  })

  it('ignores an unrecognised role value defensively', async () => {
    mockScopes([{ org_unit_id: 'x', role: 'bogus', domain: 'curriculum', path: '/inst/x/' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope).toEqual({})
  })
})
