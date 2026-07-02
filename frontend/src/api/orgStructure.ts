import client from './client'

// Canonical org-unit taxonomy (Research.md §7.1). 'institution' is the root
// and is not creatable via the tree-builder. `cluster` is displayed as
// «Полигруппа»; `program` is «Образовательная программа» (ОП / УГСН, e.g.
// 15.00.00 Машиностроение); `program_direction` is «Направление подготовки»
// (e.g. 15.03.02) — an optional sub-slot under an ОП when the ОП encompasses
// multiple направления with different РОПы. РОП `head` grants and
// `programs.org_unit_id` can attach at either `program` or `program_direction`
// depending on whether the ОП is broad or narrow.
export type OrgUnitType =
  | 'institution' | 'governance' | 'admin_office'
  | 'cluster' | 'division' | 'program' | 'program_direction' | 'department'

export interface OrgUnit {
  id:             string
  institution_id: string
  parent_id:      string | null
  type_code:      OrgUnitType
  name:           string
  short_name:     string | null
  external_code:  string | null
  path:           string
  member_count:   number
  created_at:     string
}

export async function getOrgStructure(): Promise<OrgUnit[]> {
  return (await client.get<{ units: OrgUnit[] }>('/api/institution/structure')).data.units
}

export async function createOrgUnit(input: {
  parentId:      string
  typeCode:      Exclude<OrgUnitType, 'institution'>
  name:          string
  shortName?:    string | null
  externalCode?: string | null
}): Promise<OrgUnit> {
  return (await client.post<OrgUnit>('/api/institution/structure/units', input)).data
}

// Paste-many: create N siblings under one parent in a single transaction.
export async function bulkCreateOrgUnits(input: {
  parentId: string
  typeCode: Exclude<OrgUnitType, 'institution'>
  units:    { name: string; shortName?: string | null }[]
}): Promise<OrgUnit[]> {
  return (await client.post<{ units: OrgUnit[] }>('/api/institution/structure/units/bulk', input)).data.units
}

export async function updateOrgUnit(
  unitId: string,
  patch: { name?: string; shortName?: string | null; externalCode?: string | null }
): Promise<OrgUnit> {
  return (await client.patch<OrgUnit>(`/api/institution/structure/units/${unitId}`, patch)).data
}

export async function deleteOrgUnit(unitId: string): Promise<void> {
  await client.delete(`/api/institution/structure/units/${unitId}`, { skipErrorToast: true })
}

// Deliberate re-type — type drives authorisation, so it's a separate, audited
// operation rather than part of the rename PATCH.
export async function retypeOrgUnit(unitId: string, typeCode: Exclude<OrgUnitType, 'institution'>): Promise<OrgUnit> {
  return (await client.post<OrgUnit>(`/api/institution/structure/units/${unitId}/retype`, { typeCode }, { skipErrorToast: true })).data
}

// Move a unit (with its whole subtree) under a new parent.
export async function moveOrgUnit(unitId: string, newParentId: string): Promise<OrgUnit> {
  return (await client.post<OrgUnit>(`/api/institution/structure/units/${unitId}/move`, { newParentId }, { skipErrorToast: true })).data
}

// ─── Members & roles (slice 1b) ───────────────────────────────────────────────

export type UnitRole = 'admin' | 'head' | 'viewer'

export interface InstitutionMember {
  id:                  string
  email:               string
  name:                string | null
  primary_org_unit_id: string | null
  roles:               { org_unit_id: string; role: UnitRole }[]
}

export async function getMembers(): Promise<InstitutionMember[]> {
  return (await client.get<{ members: InstitutionMember[] }>('/api/institution/structure/members')).data.members
}

export async function setPrimaryUnit(teacherId: string, unitId: string): Promise<void> {
  await client.put(`/api/institution/structure/members/${teacherId}/primary`, { unitId }, { skipErrorToast: true })
}

export async function grantRole(teacherId: string, unitId: string, role: UnitRole): Promise<void> {
  await client.post('/api/institution/structure/roles', { teacherId, unitId, role }, { skipErrorToast: true })
}

export async function revokeRole(teacherId: string, unitId: string, role: UnitRole): Promise<void> {
  await client.delete('/api/institution/structure/roles', { data: { teacherId, unitId, role }, skipErrorToast: true })
}
