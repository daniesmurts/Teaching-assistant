import { Router } from 'express'
import { generalLimiter } from '../middleware/rateLimits'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { NotFoundError, ValidationError } from '../errors/AppError'
import { saveDraftRules, consentRules } from '../validation/publishedAssignmentValidation'
import { tiptapToText } from '../lib/tiptapText'
import {
  getInviteByToken, recordConsent, saveDraft, createSnapshot,
  markInviteSubmitted, getInviteIdByToken,
} from '../db/queries/publishedAssignments'

// Public student writing surface (Feature Q3). NO teacher JWT — the per-student
// token IS the credential. Mounted at /api/write. Strict publish mode: this is
// the only route through which a published-assignment submission can be made.
//
// 152-FZ: the client sends DERIVED AGGREGATES ONLY in `telemetry`; the raw
// keystroke stream never leaves the browser.

const CONSENT_VERSION = '2026-06-v1'

const router = Router()
router.use(generalLimiter)

// Shape the public payload — never leak teacher/institution internals or the
// token itself back out.
function publicView(inv: Awaited<ReturnType<typeof getInviteByToken>>) {
  if (!inv) return null
  return {
    assignment: {
      title:        inv.title,
      instructions: inv.instructions,
      due_at:       inv.due_at,
      status:       inv.assignment_status,    // 'draft' | 'open' | 'closed'
    },
    student_name:  inv.student_name,
    status:        inv.status,                // 'invited' | 'writing' | 'submitted'
    consent_given: inv.consent_accepted_at != null,
    submitted:     inv.status === 'submitted',
    draft_content: inv.draft_content ?? null,
    consent_version: CONSENT_VERSION,
  }
}

// Load + assert the assignment is writable (published and not closed). Used by
// the mutating routes; GET is allowed in any state so the student sees context.
async function writableInvite(token: string) {
  const inv = await getInviteByToken(token)
  if (!inv) throw new NotFoundError('Задание')
  if (inv.assignment_status !== 'open') {
    throw new ValidationError(
      inv.assignment_status === 'closed' ? 'Приём работ по этому заданию закрыт' : 'Задание ещё не открыто'
    )
  }
  if (inv.status === 'submitted') throw new ValidationError('Работа уже сдана')
  return inv
}

// ─── GET — load assignment + any saved draft ──────────────────────────────────

router.get('/:token', asyncHandler(async (req, res) => {
  const inv = await getInviteByToken(req.params.token)
  const view = publicView(inv)
  if (!view) throw new NotFoundError('Задание')
  res.json(view)
}))

// ─── Consent gate (must precede writing) ──────────────────────────────────────

router.post('/:token/consent', validate(consentRules), asyncHandler(async (req, res) => {
  await writableInvite(req.params.token)
  await recordConsent(req.params.token, req.body.version || CONSENT_VERSION)
  res.json({ ok: true })
}))

// ─── Autosave draft (+ optional trajectory snapshot) ──────────────────────────

router.put('/:token/draft', validate(saveDraftRules), asyncHandler(async (req, res) => {
  const inv = await writableInvite(req.params.token)
  if (!inv.consent_accepted_at) throw new ValidationError('Необходимо согласие на запись процесса')

  await saveDraft(req.params.token, req.body.draft_content, req.body.telemetry ?? null)

  if (req.body.snapshot) {
    const inviteId = await getInviteIdByToken(req.params.token)
    if (inviteId) {
      await createSnapshot(inviteId, req.body.draft_content, tiptapToText(req.body.draft_content).length)
    }
  }
  res.json({ ok: true })
}))

// ─── Submit (finalise the invite; Q4 materialises the gradeable row) ──────────

router.post('/:token/submit', validate(saveDraftRules), asyncHandler(async (req, res) => {
  const inv = await writableInvite(req.params.token)
  if (!inv.consent_accepted_at) throw new ValidationError('Необходимо согласие на запись процесса')

  const text = tiptapToText(req.body.draft_content)
  if (text.length < 1) throw new ValidationError('Нельзя сдать пустую работу')

  // Persist the final draft + telemetry, capture a final snapshot, then submit.
  await saveDraft(req.params.token, req.body.draft_content, req.body.telemetry ?? null)
  const inviteId = await getInviteIdByToken(req.params.token)
  if (inviteId) await createSnapshot(inviteId, req.body.draft_content, text.length)

  const ok = await markInviteSubmitted(req.params.token)
  if (!ok) throw new ValidationError('Работа уже сдана')
  res.json({ ok: true })
}))

export default router
