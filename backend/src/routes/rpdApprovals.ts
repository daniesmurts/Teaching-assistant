import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireDomain } from '../middleware/requireDomain'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError } from '../errors/AppError'
import { listForwardedForInstitution, findSubmissionByIdForInstitution } from '../db/queries/rpdSubmissions'
import { transitionSubmission } from '../services/rpdSubmissions'

// УМЦ's side of the РПД approval route (docs/RPD-WORKFLOW.md phase 4b) —
// 'forwarded' items institution-wide. `umu` domain, not `curriculum`: this
// is the same split that moved Мониторинг РПД off `curriculum:edit`, so a
// Заведующий кафедрой (who legitimately holds `curriculum:edit` to author
// criteria) still doesn't see institution-wide РПД approval traffic.
const router = Router()
router.use(authenticate)
router.use(requireDomain('umu', 'view'))

function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// GET /api/institution/rpd-approvals — УМЦ's queue: everything a РОП has
// forwarded, across every programme in the institution (УМУ/УМЦ access is
// horizontal by design — see docs/ACCESS-MATRIX.md).
router.get('/', asyncHandler(async (req, res) => {
  res.json(await listForwardedForInstitution(institutionId(req)))
}))

// POST /api/institution/rpd-approvals/:submissionId/:action — 'return' or
// 'approve'. Write-gated at `umu:edit` — viewing the queue only needs
// `umu:view` (mirrors the read/write split on Мониторинг РПД itself).
router.post('/:submissionId/:action', requireDomain('umu', 'edit'), asyncHandler(async (req, res) => {
  const action = req.params.action
  if (action !== 'return' && action !== 'approve') {
    throw new ValidationError('Недопустимое действие — только return или approve')
  }

  // Scoped by institution, not a bare id lookup — otherwise a guessed/
  // enumerated submission id from another institution would be actionable
  // by anyone holding umu:edit anywhere, since `umu` is a per-institution
  // domain grant, not a global one.
  const submission = await findSubmissionByIdForInstitution(req.params.submissionId, institutionId(req))
  if (!submission || submission.status !== 'forwarded') throw new NotFoundError('Заявка на согласование')

  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 2000) : undefined
  if (action === 'return' && !comment) {
    throw new ValidationError('Укажите замечания — без них будет непонятно, что исправлять')
  }

  const result = await transitionSubmission(submission.id, action, req.teacher.id, comment)
  if ('error' in result) throw new ValidationError(result.error)
  res.json(result.submission)
}))

export default router
