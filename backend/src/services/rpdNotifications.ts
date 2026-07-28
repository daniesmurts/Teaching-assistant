import { sendEmail } from './emailTransport'
import { rpdSubmittedEmail, rpdReturnedEmail, rpdApprovedEmail } from '../lib/emailTemplates'
import { findTeacherById } from '../db/queries/teachers'
import { listRoleHoldersForUnit } from '../db/queries/orgUnits'
import { getDisciplineNotificationInfo } from '../db/queries/programs'
import { logger } from '../lib/logger'
import type { RpdSubmissionAction } from '../../../shared/types'

// The three notification emails from docs/RPD-WORKFLOW.md phase 4d. Always
// best-effort: a failed lookup or send must never surface to the caller or
// undo/block a transition that already committed — same posture as every
// other fire-and-forget side effect in this codebase (recordRagRetrievals,
// incrementUsage, …). Called from services/rpdSubmissions.ts with
// `.catch(() => null)` at the call site AND a try/catch in here, so a
// mid-lookup failure (e.g. the discipline's programme has no org_unit_id
// yet) degrades to "no email sent", not a thrown error.

/** 'submitted' → every РОП (admin/edit, curriculum domain) on the
 *  programme's org unit or an ancestor of it. Silently sends nothing if the
 *  programme has no org-tree link — there's no one determinate to notify. */
export async function notifySubmitted(disciplineId: string): Promise<void> {
  try {
    const info = await getDisciplineNotificationInfo(disciplineId)
    if (!info || !info.program_org_unit_id) return

    const holders = await listRoleHoldersForUnit(info.program_org_unit_id, ['admin', 'edit'], 'curriculum')
    await Promise.all(holders.map((h) =>
      sendEmail({
        ...rpdSubmittedEmail(h.name ?? h.email, info.discipline_name, info.program_name),
        to: h.email,
      }).catch((err) => logger.warn({ message: 'РПД submitted email failed', to: h.email, error: (err as Error).message }))
    ))
  } catch (err) {
    logger.warn({ message: 'РПД submitted notification failed', disciplineId, error: (err as Error).message })
  }
}

/** 'returned' → the discipline's responsible teacher, with the return
 *  comment. Silently sends nothing if no one is currently responsible. */
export async function notifyReturned(disciplineId: string, comment: string | null | undefined): Promise<void> {
  try {
    const info = await getDisciplineNotificationInfo(disciplineId)
    if (!info?.responsible_teacher_id) return
    const teacher = await findTeacherById(info.responsible_teacher_id)
    if (!teacher) return

    await sendEmail({
      ...rpdReturnedEmail(teacher.name ?? teacher.email, info.discipline_name, comment ?? null),
      to: teacher.email,
    })
  } catch (err) {
    logger.warn({ message: 'РПД returned notification failed', disciplineId, error: (err as Error).message })
  }
}

/** 'approved' → the discipline's responsible teacher. */
export async function notifyApproved(disciplineId: string): Promise<void> {
  try {
    const info = await getDisciplineNotificationInfo(disciplineId)
    if (!info?.responsible_teacher_id) return
    const teacher = await findTeacherById(info.responsible_teacher_id)
    if (!teacher) return

    await sendEmail({
      ...rpdApprovedEmail(teacher.name ?? teacher.email, info.discipline_name),
      to: teacher.email,
    })
  } catch (err) {
    logger.warn({ message: 'РПД approved notification failed', disciplineId, error: (err as Error).message })
  }
}

/** Dispatch table so callers (services/rpdSubmissions.ts) fire the right
 *  notification for a transition without a switch at each call site. Only
 *  'submit'/'return'/'approve' send anything — 'forward' is an internal
 *  handoff (РОП → УМЦ) with no teacher-facing email in v1. */
export function notifyForTransition(
  action: RpdSubmissionAction,
  disciplineId: string,
  comment?: string,
): void {
  switch (action) {
    case 'submit':   notifySubmitted(disciplineId).catch(() => null); return
    case 'return':   notifyReturned(disciplineId, comment).catch(() => null); return
    case 'approve':  notifyApproved(disciplineId).catch(() => null); return
    case 'forward':  return
  }
}
