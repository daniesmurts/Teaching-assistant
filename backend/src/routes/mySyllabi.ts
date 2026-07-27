import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { findDisciplinesForResponsibleTeacher } from '../db/queries/programs'

// Teacher-facing view of the programme disciplines they are responsible for
// (docs/RPD-WORKFLOW.md phase 4a) — the surface a teacher submits their РПД
// from once the approval route lands.
//
// Deliberately a separate router rather than a relaxed gate on
// /api/institution/programs. That router is `requireProgramAccess`, which a
// plain teacher fails by design; widening it so one role can reach one thing
// is the same shape as the cross-domain leaks already caught twice on the
// §7.10 axis. Here the key is RESPONSIBILITY, not a subtree grant: every row
// returned is filtered by `responsible_teacher_id = <the caller>`, so there
// is no programme id, unit id, or scope the caller could supply to widen it.
//
// No plan gate — authoring the РПД you are responsible for is part of the
// job, not a paid feature.
const router = Router()
router.use(authenticate)

// GET /api/my-syllabi
router.get('/', asyncHandler(async (req, res) => {
  res.json(await findDisciplinesForResponsibleTeacher(req.teacher.id))
}))

export default router
