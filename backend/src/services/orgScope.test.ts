import { describe, it, expect } from 'vitest'
import { pathIsAncestorOrSelf, evaluateAccess } from './orgScope'
import type { TeacherRoleScope } from '../db/queries/orgUnits'

const scope = (role: string, path: string, domain = 'all'): TeacherRoleScope => ({
  org_unit_id: path,  // id value is irrelevant to the pure evaluator
  role,
  domain,
  path,
  type_code: 'department',  // irrelevant to the pure evaluator, same as org_unit_id
})

describe('pathIsAncestorOrSelf', () => {
  it('treats a unit as ancestor of itself', () => {
    expect(pathIsAncestorOrSelf('/a/b/', '/a/b/')).toBe(true)
  })

  it('matches a true ancestor', () => {
    expect(pathIsAncestorOrSelf('/a/', '/a/b/c/')).toBe(true)
    expect(pathIsAncestorOrSelf('/a/b/', '/a/b/c/')).toBe(true)
  })

  it('rejects a descendant acting as ancestor', () => {
    expect(pathIsAncestorOrSelf('/a/b/c/', '/a/b/')).toBe(false)
  })

  it('rejects a sibling', () => {
    expect(pathIsAncestorOrSelf('/a/b/', '/a/c/')).toBe(false)
  })

  it('does not false-match on a shared id prefix without the slash boundary', () => {
    // '/a/b' is a string-prefix of '/a/bc/' but NOT a path ancestor — the
    // trailing slash on the stored path is what prevents the false positive.
    expect(pathIsAncestorOrSelf('/a/b/', '/a/bc/')).toBe(false)
  })

  it('rejects empty paths', () => {
    expect(pathIsAncestorOrSelf('', '/a/')).toBe(false)
    expect(pathIsAncestorOrSelf('/a/', '')).toBe(false)
  })
})

describe('evaluateAccess', () => {
  const root  = '/inst/'
  const dept  = '/inst/div/dept/'
  const other = '/inst/div2/dept2/'

  it('grants when an ancestor-unit role matches', () => {
    const scopes = [scope('admin', root)]
    expect(evaluateAccess(scopes, dept, ['admin'], 'teaching')).toBe(true)
  })

  it('grants an edit role on the exact unit', () => {
    const scopes = [scope('edit', dept)]
    expect(evaluateAccess(scopes, dept, ['admin', 'edit'], 'teaching')).toBe(true)
  })

  it('denies when the role is not in the allowed set', () => {
    const scopes = [scope('view', root)]
    expect(evaluateAccess(scopes, dept, ['admin', 'edit'], 'teaching')).toBe(false)
  })

  it('denies when the held unit is not an ancestor of the target', () => {
    const scopes = [scope('edit', other)]
    expect(evaluateAccess(scopes, dept, ['edit'], 'teaching')).toBe(false)
  })

  it('accommodates multiple roles across the tree', () => {
    const scopes = [scope('edit', dept), scope('view', root)]
    expect(evaluateAccess(scopes, other, ['view'], 'teaching')).toBe(true)   // view at root covers other
    expect(evaluateAccess(scopes, other, ['edit'], 'teaching')).toBe(false)  // edit only on dept, not other
  })

  it('denies with no scopes', () => {
    expect(evaluateAccess([], dept, ['admin'], 'teaching')).toBe(false)
  })

  // Research.md §7.10 Phase 2 — domain filtering. Regression coverage for the
  // cross-domain leak found while scoping Phase 2: a role held in one domain
  // must not satisfy a check for a different domain.
  it('denies a role held in a different domain', () => {
    const scopes = [scope('edit', root, 'curriculum')]
    expect(evaluateAccess(scopes, dept, ['edit', 'admin'], 'teaching')).toBe(false)
  })

  it('grants a role held in the matching domain', () => {
    const scopes = [scope('view', root, 'teaching')]
    expect(evaluateAccess(scopes, dept, ['view', 'edit', 'admin'], 'teaching')).toBe(true)
  })

  it("an 'all'-domain scope satisfies any domain requested", () => {
    const scopes = [scope('admin', root, 'all')]
    expect(evaluateAccess(scopes, dept, ['admin'], 'teaching')).toBe(true)
    expect(evaluateAccess(scopes, dept, ['admin'], 'curriculum')).toBe(true)
    expect(evaluateAccess(scopes, dept, ['admin'], 'platform')).toBe(true)
  })
})
