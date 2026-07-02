import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireLeader } from '../middleware/requireLeader'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ForbiddenError, ValidationError } from '../errors/AppError'
import { canActOnUnit } from '../services/orgScope'
import {
  listDirectLeadershipUnits, listAllInstitutionRoots,
  listSubtreeTeachers, getSubtreeActivity,
  getTeacherLeadershipProfile, getTeacherLeadershipActivity,
  listTeacherActiveSubjects, listTeacherRecentGrades,
  listProgramUnitStateForSubtree,
} from '../db/queries/leadership'
import { getOrgUnitById } from '../db/queries/orgUnits'

// «Руководство» (head dashboard) — read-only. Discoverability check is
// requireLeader; the per-target access check on /overview is canActOnUnit so a
// head can only view subtrees they actually lead (not arbitrary unit ids passed
// in the query).

const router = Router()
router.use(authenticate)
router.use(requireLeader)

// ─── GET /api/leadership/units ────────────────────────────────────────────────
// Returns the picker list. Direct holdings for regular heads/admins; all
// institution roots for the platform owner.

router.get('/units', asyncHandler(async (req, res) => {
  if (req.teacher.is_platform_admin) {
    res.json({ units: await listAllInstitutionRoots() })
    return
  }
  res.json({ units: await listDirectLeadershipUnits(req.teacher.id, req.teacher.institution_id) })
}))

// ─── GET /api/leadership/overview?unitId=… ────────────────────────────────────
// Subtree teachers + 30-day grade activity. Caller must hold head/admin on the
// unit or any ancestor (or be platform admin).

router.get('/overview', asyncHandler(async (req, res) => {
  const unitId = String(req.query.unitId ?? '')
  if (!unitId) throw new ValidationError('unitId required')

  const unit = await getOrgUnitById(unitId)
  if (!unit) throw new NotFoundError('Подразделение')

  if (!req.teacher.is_platform_admin) {
    // Same-institution guard: a role row left behind by an institution
    // reassignment must not open another org's subtree. 404 (not 403) so
    // foreign unit ids never leak.
    if (unit.institution_id !== req.teacher.institution_id) {
      throw new NotFoundError('Подразделение')
    }
    const ok = await canActOnUnit(req.teacher.id, unitId, ['head', 'admin'])
    if (!ok) throw new ForbiddenError('Нет доступа к этому подразделению')
  }

  const [activity, teachers, program_units] = await Promise.all([
    getSubtreeActivity(unitId),
    listSubtreeTeachers(unit.path),
    // Programmes in the subtree with linked-programme state — surfaces "what
    // programmes am I responsible for and what's their state" for polygroup /
    // institute / РОП heads. Empty for kafedra heads without programs under
    // them (natural fallback — frontend hides the section).
    listProgramUnitStateForSubtree(unit.path),
  ])

  res.json({
    unit:     { id: unit.id, name: unit.name, short_name: unit.short_name, type_code: unit.type_code },
    teachers,
    activity: {
      grades_by_day:    activity.grades_by_day,
      total_grades_30d: activity.total_grades_30d,
      teacher_count:    activity.teacher_count,
    },
    program_units,
  })
}))

// ─── GET /api/leadership/teachers/:id — per-teacher drill (V2) ────────────────
// Access gate walks the tree on the TEACHER's primary_org_unit_id, not on the
// caller's leadership unit. A head on кафедра X can drill into teachers whose
// primary unit is X (or any descendant of X); a head on институт Y can drill
// into any teacher in any of Y's kafedras. Platform admin bypasses.

router.get('/teachers/:id', asyncHandler(async (req, res) => {
  const teacherId = req.params.id
  const profile   = await getTeacherLeadershipProfile(teacherId)
  if (!profile) throw new NotFoundError('Преподаватель')

  if (!req.teacher.is_platform_admin) {
    // Same-institution guard first — never leak a teacher from a foreign org.
    // Explicit institution comparison (not just the primary-unit walk): after
    // an institution reassignment the target's primary_org_unit_id may still
    // point into the OLD org's tree, which the caller's stale-free role walk
    // would otherwise match.
    if (!profile.institution_id || profile.institution_id !== req.teacher.institution_id) {
      throw new ForbiddenError('Нет доступа к этому преподавателю')
    }
    if (!profile.primary_org_unit_id) {
      throw new ForbiddenError('Нет доступа к этому преподавателю')
    }
    const ok = await canActOnUnit(req.teacher.id, profile.primary_org_unit_id, ['head', 'admin'])
    if (!ok) throw new ForbiddenError('Нет доступа к этому преподавателю')
  }

  const [activity, active_subjects, recent_grades] = await Promise.all([
    getTeacherLeadershipActivity(teacherId),
    listTeacherActiveSubjects(teacherId),
    listTeacherRecentGrades(teacherId, 20),
  ])

  res.json({
    teacher: {
      id:                 profile.id,
      email:              profile.email,
      name:               profile.name,
      primary_unit_name:  profile.primary_unit_name,
    },
    activity,
    active_subjects,
    recent_grades,
  })
}))

export default router
