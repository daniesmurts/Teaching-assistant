import client from './client'

// Canonical org-unit taxonomy (Research.md §7.1). 'institution' is the root
// and is not creatable via the tree-builder. `cluster` is displayed as
// «Полигруппа»; `ugsn` is «УГСН» — the XX.00.00 укрупнённая группа (pure
// grouping, no programme semantics); `program_direction` is «Направление
// подготовки / специальность» — the ФГОС level (e.g. 09.03.04); `program` is
// «Образовательная программа» — a профиль/направленность nested under its
// направление. РОП `head` grants and `programs.org_unit_id` can attach at
// either `program_direction` or `program`, depending on whether the
// направление has one ОП or several.
export type OrgUnitType =
  | 'institution' | 'governance' | 'admin_office'
  | 'cluster' | 'division' | 'ugsn' | 'program_direction' | 'program' | 'department'

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
  // Programme metadata (migration 055) — set by the admin on program /
  // program_direction units, prefills the РОП import form.
  code:            string | null
  specialty_name:  string | null
  education_level: string | null
  forms_of_study:  string | null
}

// Programme-metadata fields an admin can set on a program/program_direction
// unit. Sent on create + update; the backend ignores them for other types.
export interface OrgUnitMeta {
  code?:           string | null
  specialtyName?:  string | null
  educationLevel?: string | null
  formsOfStudy?:   string | null
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
} & OrgUnitMeta): Promise<OrgUnit> {
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
  patch: { name?: string; shortName?: string | null; externalCode?: string | null } & OrgUnitMeta
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

export type UnitRole = 'admin' | 'edit' | 'view'

// Research.md §7.10 Phase 1 — the functional-authority axis. 'all' is a
// grant-time wildcard ("full access", today's institution-root admins); the
// concrete domains are the surfaces a grant can be narrowed to. 'admin' role
// is always paired with domain 'all' (enforced server-side).
export type GrantDomain = 'all' | 'platform' | 'curriculum' | 'teaching'

export const DOMAIN_LABEL: Record<GrantDomain, string> = {
  all:        'Все области',
  platform:   'Платформа (устройство организации)',
  curriculum: 'Учебно-методическая работа',
  teaching:   'Учебный процесс',
}

export interface InstitutionMember {
  id:                  string
  email:               string
  name:                string | null
  primary_org_unit_id: string | null
  roles:               { org_unit_id: string; role: UnitRole; domain: GrantDomain }[]
}

export async function getMembers(): Promise<InstitutionMember[]> {
  return (await client.get<{ members: InstitutionMember[] }>('/api/institution/structure/members')).data.members
}

export async function setPrimaryUnit(teacherId: string, unitId: string): Promise<void> {
  await client.put(`/api/institution/structure/members/${teacherId}/primary`, { unitId }, { skipErrorToast: true })
}

export async function grantRole(
  teacherId: string, unitId: string, role: UnitRole, domain: GrantDomain = 'all'
): Promise<void> {
  await client.post('/api/institution/structure/roles', { teacherId, unitId, role, domain }, { skipErrorToast: true })
}

export async function revokeRole(
  teacherId: string, unitId: string, role: UnitRole, domain: GrantDomain = 'all'
): Promise<void> {
  await client.delete('/api/institution/structure/roles', { data: { teacherId, unitId, role, domain }, skipErrorToast: true })
}
