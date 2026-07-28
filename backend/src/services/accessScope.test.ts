import { describe, it, expect, vi } from 'vitest'
import { getAccessScope, levelAtLeast, resolveGrant, resolveGrantOnUnitTypes, maxLevel } from './accessScope'
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
    mockScopes([{ org_unit_id: 'root', role: 'admin', domain: 'all', path: '/inst/', type_code: 'institution' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.platform).toEqual([{ level: 'admin', path: '/inst/', unitType: 'institution' }])
    expect(scope.curriculum).toEqual([{ level: 'admin', path: '/inst/', unitType: 'institution' }])
    expect(scope.teaching).toEqual([{ level: 'admin', path: '/inst/', unitType: 'institution' }])
    expect(scope.umu).toEqual([{ level: 'admin', path: '/inst/', unitType: 'institution' }])
  })

  it("a scoped domain='curriculum' edit grant reaches only curriculum", async () => {
    mockScopes([{ org_unit_id: 'umc', role: 'edit', domain: 'curriculum', path: '/inst/umc/', type_code: 'admin_office' }])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.curriculum).toEqual([{ level: 'edit', path: '/inst/umc/', unitType: 'admin_office' }])
    expect(scope.platform).toBeUndefined()
    expect(scope.teaching).toBeUndefined()
  })

  it('keeps every grant intact instead of collapsing to one level per domain', async () => {
    mockScopes([
      { org_unit_id: 'root', role: 'view', domain: 'curriculum', path: '/inst/', type_code: 'institution' },
      { org_unit_id: 'umc',  role: 'edit', domain: 'curriculum', path: '/inst/umc/', type_code: 'department' },
    ])
    const scope = await getAccessScope({ id: 't1', is_platform_admin: false, institution_id: 'inst1' })
    expect(scope.curriculum).toEqual([
      { level: 'view', path: '/inst/', unitType: 'institution' },
      { level: 'edit', path: '/inst/umc/', unitType: 'department' },
    ])
  })

  it('ignores an unrecognised role value defensively', async () => {
    mockScopes([{ org_unit_id: 'x', role: 'bogus', domain: 'curriculum', path: '/inst/x/', type_code: 'department' }])
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
      { level: 'view'  as const, path: '/inst/', unitType: 'institution' as const },
      { level: 'admin' as const, path: '/inst/div/kaf/', unitType: 'department' as const },
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
    expect(resolveGrant({ curriculum: [{ level: 'view', path: '/inst/', unitType: 'institution' }] }, 'curriculum', 'edit')).toBeNull()
  })

  it('returns null for a domain with no grants at all', () => {
    expect(resolveGrant({}, 'umu', 'view')).toBeNull()
  })

  it('deduplicates repeated paths', () => {
    const grant = resolveGrant(
      { curriculum: [
        { level: 'edit', path: '/inst/', unitType: 'department' },
        { level: 'admin', path: '/inst/', unitType: 'department' },
      ] },
      'curriculum', 'edit',
    )
    expect(grant?.pathPrefixes).toEqual(['/inst/'])
  })
})

describe('resolveGrantOnUnitTypes', () => {
  // Real-world case: a РОП's curriculum:admin grant sits on their `program`
  // unit — same domain+level a ЗК's curriculum:edit grant on `department`
  // would have, but Критерии/Рубрики curation is department/institute
  // leadership territory, not a programme head's.
  it("rejects a qualifying-level grant whose unit type isn't in allowedTypes (a РОП's `program` grant)", () => {
    const scope = { curriculum: [{ level: 'admin' as const, path: '/inst/prog/', unitType: 'program' as const }] }
    expect(resolveGrantOnUnitTypes(scope, 'curriculum', 'view', ['department', 'division'])).toBeNull()
  })

  it("accepts a grant whose unit type IS in allowedTypes (a ЗК's `department` grant)", () => {
    const scope = { curriculum: [{ level: 'edit' as const, path: '/inst/dept/', unitType: 'department' as const }] }
    const grant = resolveGrantOnUnitTypes(scope, 'curriculum', 'view', ['department', 'division'])
    expect(grant?.pathPrefixes).toEqual(['/inst/dept/'])
  })

  it('always accepts a grant on the institution root regardless of allowedTypes (root/all-domain admin)', () => {
    const scope = { curriculum: [{ level: 'admin' as const, path: '/inst/', unitType: 'institution' as const }] }
    const grant = resolveGrantOnUnitTypes(scope, 'curriculum', 'edit', ['department', 'division'])
    expect(grant?.pathPrefixes).toEqual(['/inst/'])
  })

  it('still enforces minLevel on top of the unit-type filter', () => {
    const scope = { curriculum: [{ level: 'view' as const, path: '/inst/dept/', unitType: 'department' as const }] }
    expect(resolveGrantOnUnitTypes(scope, 'curriculum', 'edit', ['department'])).toBeNull()
  })

  it('unions paths only from grants that pass BOTH the level and type filters', () => {
    const scope = {
      curriculum: [
        { level: 'edit' as const, path: '/inst/dept-a/', unitType: 'department' as const },  // qualifies
        { level: 'admin' as const, path: '/inst/prog-b/', unitType: 'program' as const },     // wrong type
        { level: 'view' as const, path: '/inst/dept-c/', unitType: 'department' as const },   // below minLevel
      ],
    }
    const grant = resolveGrantOnUnitTypes(scope, 'curriculum', 'edit', ['department'])
    expect(grant?.pathPrefixes).toEqual(['/inst/dept-a/'])
  })
})

describe('maxLevel', () => {
  it('reports the highest level held anywhere in the domain', () => {
    expect(maxLevel({ teaching: [
      { level: 'view', path: '/a/', unitType: 'department' },
      { level: 'admin', path: '/b/', unitType: 'division' },
    ] }, 'teaching')).toBe('admin')
  })

  it('returns null for a domain with no grants', () => {
    expect(maxLevel({}, 'teaching')).toBeNull()
  })
})
