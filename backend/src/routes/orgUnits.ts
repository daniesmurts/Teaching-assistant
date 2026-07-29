import { Router, type Request } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireInstitutionAdmin } from '../middleware/requireRole'
import { requireDomain } from '../middleware/requireDomain'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError, ForbiddenError } from '../errors/AppError'
import { pathIsAncestorOrSelf } from '../services/orgScope'
import {
  createOrgUnitRules, bulkCreateOrgUnitsRules, updateOrgUnitRules,
  retypeOrgUnitRules, moveOrgUnitRules,
  grantRoleRules, setPrimaryRules,
} from '../validation/orgUnitValidation'
import {
  listOrgUnitsWithCounts, getOrgUnitById, getOrgUnitDependents,
  createOrgUnit, bulkCreateOrgUnits, updateOrgUnit, deleteOrgUnit,
  retypeOrgUnit, moveOrgUnit, countDirectPrimaryMembers,
  listInstitutionMembersWithRoles, isTeacherInInstitution, countRoleOnUnit,
  addUnitRole, removeUnitRole, setPrimaryOrgUnit, getRootUnitForInstitution,
  type OrgUnitType, type UnitRole, type GrantDomain,
} from '../db/queries/orgUnits'
import { recordAudit } from '../db/queries/audit'
import { findTeacherRowById } from '../db/queries/teachers'

// Org-structure tree builder — the IT-admin surface (Research.md §7.4), plus
// (Phase 3 slice B) sub-unit admins scoped to their own subtree. Mounted
// under /api/institution/structure. Gated by requireDomain('platform','admin')
// — reached by true institution-root admins (role='admin', domain='all', on
// the institution root) AND by sub-unit platform:admin grants (Phase 3 slice
// B, e.g. an institute director); the coarse gate alone does not distinguish
// them. Real scoping is per-route below via
// `unitInScope` (write endpoints) and `req.domainScope.pathPrefixes` (list
// endpoints). `PUT /members/:teacherId/primary` stays root-admin-only
// explicitly — reassigning which department a teacher belongs to is
// centrally-owned provisioning, not delegated (confirmed against real
// practice at KNITU), same as invites/deactivation in routes/institution.ts.

const router = Router()
router.use(authenticate)
router.use(requireDomain('platform', 'admin'))
// This router records its own rich audit rows (recordAudit calls below) — opt
// out of the catch-all auditLog middleware. Any new mutation here MUST call
// recordAudit or it will go unlogged.
router.use((_req, res, next) => { res.locals.selfAudited = true; next() })

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// Load a unit and assert it belongs to the caller's institution. 404 (not 403)
// so we never reveal that another institution's unit id exists.
async function unitInInstitution(unitId: string, instId: string) {
  const unit = await getOrgUnitById(unitId)
  if (!unit || unit.institution_id !== instId) throw new NotFoundError('Подразделение')
  return unit
}

/**
 * Load a unit, assert it belongs to the caller's institution (404, as
 * `unitInInstitution`), and — Phase 3 slice B — assert it falls within the
 * caller's granted subtree. `req.domainScope` is unset when platform_admin
 * bypassed `requireDomain` (unrestricted) or, defensively, if somehow absent;
 * a root admin's own `pathPrefixes` is `[rootPath]`, which is an ancestor of
 * every unit in the institution, so this is a no-op for every admin that
 * exists today. 403 (not 404) once out-of-scope — the unit demonstrably
 * exists in their own institution, they just lack rights to it (same
 * same-institution/out-of-scope convention as routes/leadership.ts).
 */
async function unitInScope(unitId: string, instId: string, req: Request) {
  const unit = await unitInInstitution(unitId, instId)
  const prefixes = req.domainScope?.pathPrefixes
  if (prefixes && !prefixes.some((p) => pathIsAncestorOrSelf(p, unit.path))) {
    throw new ForbiddenError('Подразделение вне вашей области ответственности')
  }
  return unit
}

// Programme metadata is only meaningful for the two programme-anchor types.
const PROGRAMME_TYPES = new Set(['program', 'program_direction'])

// Pull the (optional) programme-metadata fields off a request body into the
// query layer's shape. A field present in the body (even as '') is treated as
// an explicit set/clear; absent keys stay undefined so the update leaves the
// column untouched.
function extractMeta(body: Record<string, unknown>): {
  code?: string | null; specialtyName?: string | null
  educationLevel?: string | null; formsOfStudy?: string | null
} {
  const norm = (v: unknown) => (typeof v === 'string' ? (v.trim() || null) : null)
  const out: Record<string, string | null> = {}
  if ('code'           in body) out.code           = norm(body.code)
  if ('specialtyName'  in body) out.specialtyName  = norm(body.specialtyName)
  if ('educationLevel' in body) out.educationLevel = norm(body.educationLevel)
  if ('formsOfStudy'   in body) out.formsOfStudy   = norm(body.formsOfStudy)
  return out
}

// ─── Tree ─────────────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  res.json({ units: await listOrgUnitsWithCounts(institutionId(req), req.domainScope?.pathPrefixes) })
}))

// ─── Create a unit under a parent ─────────────────────────────────────────────

router.post('/units', validate(createOrgUnitRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { parentId, typeCode, name, shortName, externalCode } = req.body

  // Parent must exist, belong to this institution, and be in the caller's scope.
  await unitInScope(parentId, instId, req)

  const unit = await createOrgUnit({
    institutionId: instId,
    parentId,
    typeCode:      typeCode as OrgUnitType,
    name:          name.trim(),
    shortName:     shortName?.trim() || null,
    externalCode:  externalCode?.trim() || null,
    // Only programme-anchor units carry ФГОС metadata — ignore it for others.
    meta:          PROGRAMME_TYPES.has(typeCode) ? extractMeta(req.body) : undefined,
  })
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_unit.created', target: unit.name, metadata: { unitId: unit.id, typeCode: unit.type_code } })
  res.status(201).json(unit)
}))

// ─── Bulk create siblings under one parent (paste-many UI) ───────────────────

router.post('/units/bulk', validate(bulkCreateOrgUnitsRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { parentId, typeCode, units } = req.body as {
    parentId: string; typeCode: string
    units: { name: string; shortName?: string | null }[]
  }

  const parent = await unitInScope(parentId, instId, req)

  // Reject batches that contain duplicate names — clearer error than letting the
  // DB UNIQUE fire mid-transaction on the second row.
  const normalized = units.map((u) => ({
    name:      u.name.trim(),
    shortName: u.shortName?.trim() || null,
  }))
  const seen = new Set<string>()
  for (const u of normalized) {
    const key = u.name.toLowerCase()
    if (seen.has(key)) throw new ValidationError(`В списке есть повторяющееся название: «${u.name}»`)
    seen.add(key)
  }

  const created = await bulkCreateOrgUnits({
    institutionId: instId,
    parentId,
    typeCode:      typeCode as OrgUnitType,
    units:         normalized,
  })
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_unit.bulk_created', target: parent.name,
    metadata: { parentId, typeCode, count: created.length } })
  res.status(201).json({ units: created })
}))

// ─── Rename / edit a unit ─────────────────────────────────────────────────────

router.patch('/units/:unitId', validate(updateOrgUnitRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const existing = await unitInScope(req.params.unitId, instId, req)

  const updated = await updateOrgUnit(req.params.unitId, {
    name:         req.body.name?.trim(),
    shortName:    req.body.shortName    !== undefined ? (req.body.shortName?.trim()    || null) : undefined,
    externalCode: req.body.externalCode !== undefined ? (req.body.externalCode?.trim() || null) : undefined,
    // ФГОС metadata only for programme-anchor units — a rename PATCH on a
    // kafedra never touches these columns.
    ...(PROGRAMME_TYPES.has(existing.type_code) ? extractMeta(req.body) : {}),
  })
  if (!updated) throw new NotFoundError('Подразделение')
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_unit.updated', target: updated.name, metadata: { unitId: updated.id } })
  res.json(updated)
}))

// ─── Re-type a unit (deliberate — type drives authorisation) ─────────────────

const PROGRAM_PAIR = new Set(['program', 'program_direction'])

router.post('/units/:unitId/retype', validate(retypeOrgUnitRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const unit = await unitInScope(req.params.unitId, instId, req)
  const newType = req.body.typeCode as OrgUnitType

  if (!unit.parent_id) throw new ValidationError('Нельзя изменить тип корневого подразделения')
  if (newType === unit.type_code) { res.json(unit); return }

  // Teachers are anchored to departments (§7.1) — re-typing a department away
  // while members point at it would orphan their primary unit.
  if (unit.type_code === 'department' && newType !== 'department') {
    const members = await countDirectPrimaryMembers(unit.id)
    if (members > 0) {
      throw new ValidationError(
        `К кафедре привязаны преподаватели (${members}) — сначала переведите их в другую кафедру`
      )
    }
  }

  // program ↔ program_direction reclassification is always allowed (both are
  // valid programme anchors); leaving the pair while a programme is linked
  // would break the РОП's scope resolution.
  if (PROGRAM_PAIR.has(unit.type_code) && !PROGRAM_PAIR.has(newType)) {
    const { programs } = await getOrgUnitDependents(unit.id)
    if (programs > 0) {
      throw new ValidationError(
        `К подразделению привязаны образовательные программы (${programs}) — сначала отвяжите их`
      )
    }
  }

  const updated = await retypeOrgUnit(unit.id, newType)
  if (!updated) throw new NotFoundError('Подразделение')
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_unit.retyped', target: updated.name,
    metadata: { unitId: updated.id, fromType: unit.type_code, toType: newType } })
  res.json(updated)
}))

// ─── Move a unit (and its subtree) under a new parent ────────────────────────

router.post('/units/:unitId/move', validate(moveOrgUnitRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const unit = await unitInScope(req.params.unitId, instId, req)
  if (!unit.parent_id) throw new ValidationError('Нельзя переместить корневое подразделение')

  // Both sides must be in scope — otherwise a sub-unit admin could pull a
  // unit in from outside their subtree, or move one of their own out to
  // somewhere they no longer control.
  const newParent = await unitInScope(req.body.newParentId, instId, req)
  if (newParent.id === unit.parent_id) { res.json(unit); return }

  let moved
  try {
    moved = await moveOrgUnit(unit.id, newParent.id, instId)
  } catch (err) {
    if ((err as Error).message === 'CYCLE') {
      throw new ValidationError('Нельзя переместить подразделение внутрь его собственной структуры')
    }
    // UNIQUE (institution_id, parent_id, name) — a sibling with this name
    // already exists under the new parent.
    if ((err as { code?: string }).code === '23505') {
      throw new ValidationError('У нового родителя уже есть подразделение с таким названием')
    }
    throw err
  }
  if (!moved) throw new NotFoundError('Подразделение')

  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_unit.moved', target: moved.name,
    metadata: { unitId: moved.id, toParentId: newParent.id, toParentName: newParent.name } })
  res.json(moved)
}))

// ─── Delete a unit ────────────────────────────────────────────────────────────

router.delete('/units/:unitId', asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const unit = await unitInScope(req.params.unitId, instId, req)

  if (!unit.parent_id) {
    throw new ValidationError('Нельзя удалить корневое подразделение организации')
  }

  // Refuse to mass-orphan: the admin must move children and teachers out first.
  const { children, members, programs } = await getOrgUnitDependents(unit.id)
  if (children > 0 || members > 0) {
    throw new ValidationError(
      `Сначала переместите вложенные подразделения (${children}) и преподавателей (${members}) из этого подразделения`
    )
  }
  // Linked programmes would be silently unlinked by the FK's SET NULL — the
  // РОП instantly loses access and only an IT admin can re-link. Make the
  // admin detach deliberately (programme detail → «Подразделение в структуре»).
  if (programs > 0) {
    throw new ValidationError(
      `К подразделению привязаны образовательные программы (${programs}) — сначала отвяжите их на странице программы`
    )
  }

  const ok = await deleteOrgUnit(unit.id)
  if (!ok) throw new NotFoundError('Подразделение')
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_unit.deleted', target: unit.name, metadata: { unitId: unit.id, typeCode: unit.type_code } })
  res.status(204).end()
}))

// ─── Members & roles (slice 1b) ───────────────────────────────────────────────

router.get('/members', asyncHandler(async (req, res) => {
  res.json({ members: await listInstitutionMembersWithRoles(institutionId(req), req.domainScope?.pathPrefixes) })
}))

// Assign a teacher's primary unit (their kafedra). Must be a department in this
// institution — teachers belong to a department (§7.1). Deliberately stays
// root-admin-only even though the router's coarse gate now also admits
// sub-unit admins (Phase 3 slice B): which department a teacher belongs to
// is centrally-owned provisioning at real institutions (confirmed against
// KNITU practice), not delegated — same as invites/deactivation.
router.put('/members/:teacherId/primary', requireInstitutionAdmin, validate(setPrimaryRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  if (!(await isTeacherInInstitution(req.params.teacherId, instId))) {
    throw new NotFoundError('Преподаватель')
  }
  const unit = await unitInInstitution(req.body.unitId, instId)
  if (unit.type_code !== 'department') {
    throw new ValidationError('Преподавателя можно привязать только к кафедре')
  }
  await setPrimaryOrgUnit(req.params.teacherId, unit.id)
  const member = await findTeacherRowById(req.params.teacherId)
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_member.primary_set', target: member?.email ?? req.params.teacherId,
    metadata: { teacherId: req.params.teacherId, unitId: unit.id, unitName: unit.name } })
  res.json({ ok: true })
}))

// Grant a unit-scoped role to a teacher.
router.post('/roles', validate(grantRoleRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { teacherId, unitId, role } = req.body
  const domain = (req.body.domain as GrantDomain | undefined) ?? 'all'
  if (!(await isTeacherInInstitution(teacherId, instId))) throw new NotFoundError('Преподаватель')
  const unit = await unitInScope(unitId, instId, req)
  // domain='all' means "every functional axis" — on the institution root
  // that IS institution-wide admin (isInstitutionAdmin's exact signal), but
  // on any other unit it would silently make role='admin' institution-wide
  // too, since getAccessScope expands domain='all' across every domain
  // (platform/curriculum/teaching/umu) regardless of how narrow the unit is.
  // 'admin' on a non-root unit must pick a real domain, same as 'edit'/
  // 'view' — its authority then stays scoped to this unit's own subtree,
  // exactly like an equivalently-scoped 'edit' (the only functional gap
  // between the two today is Структура's platform:admin gate).
  if (role === 'admin' && domain === 'all' && unit.type_code !== 'institution') {
    throw new ValidationError('«Администратор» с областью «Все» доступен только на уровне всей организации — выберите конкретную область для этого подразделения')
  }
  await addUnitRole(teacherId, unitId, role as UnitRole, domain)
  const member = await findTeacherRowById(teacherId)
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_role.granted', target: member?.email ?? teacherId,
    metadata: { teacherId, role, domain, unitId, unitName: unit.name, unitType: unit.type_code } })
  res.status(201).json({ ok: true })
}))

// Revoke a unit-scoped role. Refuses to remove the last admin on the
// institution root — that would lock the organisation out of its own admin.
router.delete('/roles', validate(grantRoleRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { teacherId, unitId, role } = req.body
  const domain = (req.body.domain as GrantDomain | undefined) ?? 'all'
  if (!(await isTeacherInInstitution(teacherId, instId))) throw new NotFoundError('Преподаватель')
  const unit = await unitInScope(unitId, instId, req)
  const member = await findTeacherRowById(teacherId)

  // Lockout guard: never revoke the last ACTIVE admin on the institution root
  // (countRoleOnUnit counts active holders only — a deactivated admin can't
  // log in and mustn't satisfy the guard). Revoking from an already-
  // deactivated holder can't worsen lockout, so it's always allowed.
  if (role === 'admin' && domain === 'all' && member?.is_active) {
    const root = await getRootUnitForInstitution(instId)
    if (root && root.id === unitId && (await countRoleOnUnit(unitId, 'admin', 'all')) <= 1) {
      throw new ValidationError('Нельзя снять роль у последнего администратора организации')
    }
  }

  await removeUnitRole(teacherId, unitId, role as UnitRole, domain)
  recordAudit({ institutionId: instId, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'org_role.revoked', target: member?.email ?? teacherId,
    metadata: { teacherId, role, domain, unitId, unitName: unit.name, unitType: unit.type_code } })
  res.json({ ok: true })
}))

export default router
