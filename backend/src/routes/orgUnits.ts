import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireInstitutionAdmin } from '../middleware/requireRole'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  createOrgUnitRules, updateOrgUnitRules, grantRoleRules, setPrimaryRules,
} from '../validation/orgUnitValidation'
import {
  listOrgUnitsWithCounts, getOrgUnitById, getOrgUnitDependents,
  createOrgUnit, updateOrgUnit, deleteOrgUnit,
  listInstitutionMembersWithRoles, isTeacherInInstitution, countRoleOnUnit,
  addUnitRole, removeUnitRole, setPrimaryOrgUnit, getRootUnitForInstitution,
  type OrgUnitType, type UnitRole,
} from '../db/queries/orgUnits'

// Org-structure tree builder — the IT-admin surface (Research.md §7.4).
// Mounted under /api/institution/structure. Guarded by requireInstitutionAdmin
// — now tree-backed: admin on the institution root unit (or platform owner).
// Every operation is additionally scoped to the admin's OWN institution; target
// unit ownership is re-checked per op (404, never 403, so foreign ids don't leak).

const router = Router()
router.use(authenticate)
router.use(requireInstitutionAdmin)

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

// ─── Tree ─────────────────────────────────────────────────────────────────────

router.get('/', asyncHandler(async (req, res) => {
  res.json({ units: await listOrgUnitsWithCounts(institutionId(req)) })
}))

// ─── Create a unit under a parent ─────────────────────────────────────────────

router.post('/units', validate(createOrgUnitRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { parentId, typeCode, name, shortName, externalCode } = req.body

  // Parent must exist and belong to this institution.
  await unitInInstitution(parentId, instId)

  const unit = await createOrgUnit({
    institutionId: instId,
    parentId,
    typeCode:      typeCode as OrgUnitType,
    name:          name.trim(),
    shortName:     shortName?.trim() || null,
    externalCode:  externalCode?.trim() || null,
  })
  res.status(201).json(unit)
}))

// ─── Rename / edit a unit ─────────────────────────────────────────────────────

router.patch('/units/:unitId', validate(updateOrgUnitRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  await unitInInstitution(req.params.unitId, instId)

  const updated = await updateOrgUnit(req.params.unitId, {
    name:         req.body.name?.trim(),
    shortName:    req.body.shortName    !== undefined ? (req.body.shortName?.trim()    || null) : undefined,
    externalCode: req.body.externalCode !== undefined ? (req.body.externalCode?.trim() || null) : undefined,
  })
  if (!updated) throw new NotFoundError('Подразделение')
  res.json(updated)
}))

// ─── Delete a unit ────────────────────────────────────────────────────────────

router.delete('/units/:unitId', asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const unit = await unitInInstitution(req.params.unitId, instId)

  if (!unit.parent_id) {
    throw new ValidationError('Нельзя удалить корневое подразделение организации')
  }

  // Refuse to mass-orphan: the admin must move children and teachers out first.
  const { children, members } = await getOrgUnitDependents(unit.id)
  if (children > 0 || members > 0) {
    throw new ValidationError(
      `Сначала переместите вложенные подразделения (${children}) и преподавателей (${members}) из этого подразделения`
    )
  }

  const ok = await deleteOrgUnit(unit.id)
  if (!ok) throw new NotFoundError('Подразделение')
  res.status(204).end()
}))

// ─── Members & roles (slice 1b) ───────────────────────────────────────────────

router.get('/members', asyncHandler(async (req, res) => {
  res.json({ members: await listInstitutionMembersWithRoles(institutionId(req)) })
}))

// Assign a teacher's primary unit (their kafedra). Must be a department in this
// institution — teachers belong to a department (§7.1).
router.put('/members/:teacherId/primary', validate(setPrimaryRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  if (!(await isTeacherInInstitution(req.params.teacherId, instId))) {
    throw new NotFoundError('Преподаватель')
  }
  const unit = await unitInInstitution(req.body.unitId, instId)
  if (unit.type_code !== 'department') {
    throw new ValidationError('Преподавателя можно привязать только к кафедре')
  }
  await setPrimaryOrgUnit(req.params.teacherId, unit.id)
  res.json({ ok: true })
}))

// Grant a unit-scoped role to a teacher.
router.post('/roles', validate(grantRoleRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { teacherId, unitId, role } = req.body
  if (!(await isTeacherInInstitution(teacherId, instId))) throw new NotFoundError('Преподаватель')
  await unitInInstitution(unitId, instId)
  await addUnitRole(teacherId, unitId, role as UnitRole)
  res.status(201).json({ ok: true })
}))

// Revoke a unit-scoped role. Refuses to remove the last admin on the
// institution root — that would lock the organisation out of its own admin.
router.delete('/roles', validate(grantRoleRules), asyncHandler(async (req, res) => {
  const instId = institutionId(req)
  const { teacherId, unitId, role } = req.body
  if (!(await isTeacherInInstitution(teacherId, instId))) throw new NotFoundError('Преподаватель')
  await unitInInstitution(unitId, instId)

  if (role === 'admin') {
    const root = await getRootUnitForInstitution(instId)
    if (root && root.id === unitId && (await countRoleOnUnit(unitId, 'admin')) <= 1) {
      throw new ValidationError('Нельзя снять роль у последнего администратора организации')
    }
  }

  await removeUnitRole(teacherId, unitId, role as UnitRole)
  res.json({ ok: true })
}))

export default router
