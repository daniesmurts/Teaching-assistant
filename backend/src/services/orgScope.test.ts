import { describe, it, expect } from 'vitest'
import { pathIsAncestorOrSelf, evaluateAccess } from './orgScope'
import type { TeacherRoleScope } from '../db/queries/orgUnits'

const scope = (role: string, path: string): TeacherRoleScope => ({
  org_unit_id: path,  // id value is irrelevant to the pure evaluator
  role,
  path,
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
    expect(evaluateAccess(scopes, dept, ['admin'])).toBe(true)
  })

  it('grants a head role on the exact unit', () => {
    const scopes = [scope('head', dept)]
    expect(evaluateAccess(scopes, dept, ['admin', 'head'])).toBe(true)
  })

  it('denies when the role is not in the allowed set', () => {
    const scopes = [scope('viewer', root)]
    expect(evaluateAccess(scopes, dept, ['admin', 'head'])).toBe(false)
  })

  it('denies when the held unit is not an ancestor of the target', () => {
    const scopes = [scope('head', other)]
    expect(evaluateAccess(scopes, dept, ['head'])).toBe(false)
  })

  it('accommodates multiple roles across the tree', () => {
    const scopes = [scope('head', dept), scope('viewer', root)]
    expect(evaluateAccess(scopes, other, ['viewer'])).toBe(true)   // viewer at root covers other
    expect(evaluateAccess(scopes, other, ['head'])).toBe(false)    // head only on dept, not other
  })

  it('denies with no scopes', () => {
    expect(evaluateAccess([], dept, ['admin'])).toBe(false)
  })
})
