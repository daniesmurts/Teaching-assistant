import { describe, it, expect } from 'vitest'
import {
  FEATURE_CATALOG, evaluateAccess, programScope, accessDelta, nearMisses,
  CRITERIA_READ_UNIT_TYPES   as CATALOG_CRITERIA_READ,
  CRITERIA_CREATE_UNIT_TYPES as CATALOG_CRITERIA_CREATE,
  TEACHING_OVERVIEW_UNIT_TYPES as CATALOG_TEACHING_OVERVIEW,
  METHODIST_UNIT_TYPES       as CATALOG_METHODIST,
  ACCESS_DOMAINS, ACCESS_LEVELS, levelAtLeast,
  type HeldGrant, type CatalogUnitType, type GrantDomainValue, type AccessLevel,
} from '../../../shared/accessCatalog'
import {
  CRITERIA_READ_UNIT_TYPES, CRITERIA_CREATE_UNIT_TYPES,
  TEACHING_OVERVIEW_UNIT_TYPES, METHODIST_UNIT_TYPES,
  levelAtLeast as serverLevelAtLeast,
} from './accessScope'
import { DOMAINS, ORG_UNIT_TYPES } from '../db/queries/orgUnits'

// The catalog explains the gates in middleware/requireDomain.ts to org admins.
// If it drifts from them it stops being an explanation and becomes a lie, so
// every axis it replicates is pinned to the constant the real gate uses.

let seq = 0
const grant = (
  level: AccessLevel, domain: GrantDomainValue, unitType: CatalogUnitType, unitName: string = unitType
): HeldGrant => ({ level, domain, unitType, unitId: `u${seq++}`, unitName })

const granted = (grants: HeldGrant[]): Set<string> =>
  new Set(evaluateAccess(grants).filter((v) => v.granted).map((v) => v.feature.key))

describe('accessCatalog — drift guard against the real gates', () => {
  it('mirrors the server unit-type policies verbatim', () => {
    expect([...CATALOG_CRITERIA_READ]).toEqual([...CRITERIA_READ_UNIT_TYPES])
    expect([...CATALOG_CRITERIA_CREATE]).toEqual([...CRITERIA_CREATE_UNIT_TYPES])
    expect([...CATALOG_TEACHING_OVERVIEW]).toEqual([...TEACHING_OVERVIEW_UNIT_TYPES])
    expect([...CATALOG_METHODIST]).toEqual([...METHODIST_UNIT_TYPES])
  })

  it('covers exactly the server domain and unit-type vocabularies', () => {
    expect([...ACCESS_DOMAINS]).toEqual([...DOMAINS])
    for (const feature of FEATURE_CATALOG) {
      if (feature.gate.kind !== 'domain') continue
      expect(DOMAINS).toContain(feature.gate.domain)
      for (const t of feature.gate.unitTypes ?? []) expect(ORG_UNIT_TYPES).toContain(t)
    }
  })

  it('ranks levels the way accessScope does', () => {
    for (const have of ACCESS_LEVELS) {
      for (const need of ACCESS_LEVELS) {
        expect(levelAtLeast(have, need)).toBe(serverLevelAtLeast(have, need))
      }
    }
  })

  it('has unique feature keys', () => {
    const keys = FEATURE_CATALOG.map((f) => f.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('accessCatalog — Table A bundles resolve to the Table §4 matrix', () => {
  it('Администратор организации sees everything', () => {
    const keys = granted([grant('admin', 'all', 'institution', 'КНИТУ')])
    expect(keys.size).toBe(FEATURE_CATALOG.length)
  })

  it('Преподаватель (no grants) sees nothing', () => {
    expect(granted([]).size).toBe(0)
  })

  it('Заведующий кафедрой: creates criteria, never sees Мониторинг РПД', () => {
    const keys = granted([
      grant('admin', 'teaching', 'department', 'Кафедра ХТ'),
      grant('edit', 'curriculum', 'department', 'Кафедра ХТ'),
    ])
    expect(keys).toContain('criteriaCreate')
    expect(keys).toContain('overview')
    expect(keys).toContain('leadershipSummary')
    expect(keys).not.toContain('rpdMonitorRead')
    expect(keys).not.toContain('umcReadiness')
    expect(keys).not.toContain('structure')
  })

  it('Методист/Нач. УМУ: Мониторинг РПД, but not the Обзор/Преподаватели surfaces', () => {
    const keys = granted([
      grant('edit', 'umu', 'admin_office', 'УМУ'),
      grant('edit', 'curriculum', 'admin_office', 'УМУ'),
    ])
    expect(keys).toContain('rpdMonitorEdit')
    expect(keys).toContain('umcReadiness')
    expect(keys).toContain('methodist')
    expect(keys).not.toContain('overview')
    expect(keys).not.toContain('teachersRead')
    expect(keys).not.toContain('criteriaCreate')
  })

  it('Методист УМЦ (curriculum:edit only) reaches Кабинет методиста but no umu surface', () => {
    const keys = granted([grant('edit', 'curriculum', 'admin_office', 'УМЦ / отдел')])
    expect(keys).toContain('methodist')
    expect(keys).not.toContain('rpdMonitorRead')
    expect(keys).not.toContain('umcReadiness')
  })

  it('Руководитель ОП: own programmes, no institution-oversight surfaces', () => {
    const grants = [
      grant('admin', 'curriculum', 'program', 'ОП 09.03.04'),
      grant('view', 'teaching', 'program', 'ОП 09.03.04'),
    ]
    expect(programScope(grants)).toBe('specific')
    const keys = granted(grants)
    expect(keys).toContain('programsWrite')
    expect(keys).toContain('leadershipSummary')
    expect(keys).not.toContain('overview')
    expect(keys).not.toContain('criteriaRead')
    expect(keys).not.toContain('criteriaCreate')
  })

  it('Ректор (view on the root) reads programmes but cannot write them', () => {
    const grants = [
      grant('view', 'teaching', 'institution', 'КНИТУ'),
      grant('view', 'curriculum', 'institution', 'КНИТУ'),
    ]
    expect(programScope(grants)).toBe('all-ro')
    const keys = granted(grants)
    expect(keys).toContain('programsRead')
    expect(keys).not.toContain('programsWrite')
    expect(keys).toContain('overview')          // root grant clears the unit-type policy
    expect(keys).not.toContain('teachersInvite') // view, not root admin
  })

  it('Проректор: strategy via platform:edit, but not the org tree', () => {
    const keys = granted([
      grant('view', 'teaching', 'governance', 'Ректорат'),
      grant('view', 'curriculum', 'governance', 'Ректорат'),
      grant('edit', 'platform', 'governance', 'Ректорат'),
    ])
    expect(keys).toContain('strategy')
    expect(keys).not.toContain('structure')
  })

  it('a teaching-only grant never unlocks programme editing', () => {
    expect(programScope([grant('admin', 'teaching', 'department')])).toBe('none')
  })

  it('governance/admin_office curriculum grants are institution-wide for programmes', () => {
    expect(programScope([grant('edit', 'curriculum', 'admin_office', 'УМЦ')])).toBe('all-rw')
    expect(programScope([grant('edit', 'curriculum', 'department', 'Кафедра')])).toBe('specific')
  })
})

describe('accessCatalog — assign-form helpers', () => {
  it('accessDelta reports only what the new grant adds', () => {
    const existing = [grant('view', 'umu', 'admin_office', 'УМУ')]
    const pending  = grant('edit', 'umu', 'admin_office', 'УМУ')
    const { gained, already } = accessDelta(existing, [...existing, pending])
    const gainedKeys = gained.map((v) => v.feature.key)
    expect(gainedKeys).toContain('rpdMonitorEdit')
    expect(gainedKeys).not.toContain('rpdMonitorRead')
    expect(already.map((v) => v.feature.key)).toContain('rpdMonitorRead')
  })

  it('accessDelta is empty when an existing role already covers the new one', () => {
    const existing = [grant('admin', 'all', 'institution', 'КНИТУ')]
    const { gained } = accessDelta(existing, [...existing, grant('edit', 'umu', 'admin_office', 'УМУ')])
    expect(gained).toEqual([])
  })

  it('nearMisses explains why a same-область feature stayed closed', () => {
    const misses = nearMisses(grant('view', 'umu', 'admin_office', 'УМУ'))
    const byKey = new Map(misses.map((v) => [v.feature.key, v.reason]))
    expect(byKey.get('rpdMonitorEdit')).toBe('level')
    expect(byKey.has('rpdMonitorRead')).toBe(false)
  })

  it('nearMisses flags the wrong-unit-type case', () => {
    const misses = nearMisses(grant('edit', 'curriculum', 'program', 'ОП'))
    expect(new Map(misses.map((v) => [v.feature.key, v.reason])).get('criteriaCreate')).toBe('unitType')
  })

  it('never reports a root-admin-only feature as a near miss', () => {
    for (const g of [grant('admin', 'platform', 'division'), grant('edit', 'umu', 'admin_office')]) {
      expect(nearMisses(g).some((v) => v.feature.gate.kind === 'rootAdmin')).toBe(false)
    }
  })
})
