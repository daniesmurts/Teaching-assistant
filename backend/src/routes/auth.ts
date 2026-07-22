import { Router, type Request } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { authLimiter, publicFormLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { signToken } from '../lib/jwt'
import { escapeHtml } from '../lib/escapeHtml'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  registerRules, loginRules, forgotPasswordRules, resetPasswordRules,
  marketingUnsubscribeByEmailRules,
} from '../validation/authValidation'
import {
  findTeacherByEmail, findTeacherRowById, createTeacher, updateTeacherPassword,
} from '../db/queries/teachers'
import { getOrCreateCounter } from '../db/queries/usageCounters'
import { countTopicsThisMonth } from '../db/queries/topics'
import { countQuizzesThisMonth } from '../db/queries/quizzes'
import { getLimits, canUseFeature } from '../config/planLimits'
import { computeEffectiveTier } from '../lib/planTier'
import {
  generateRawToken, hashToken, createResetToken,
  invalidateExistingTokens, findValidToken, markTokenUsed,
} from '../db/queries/passwordReset'
import { sendEmail, adminNotifyTo } from '../services/emailTransport'
import {
  registrationEmail, passwordResetEmail, passwordChangedEmail, adminSignupEmail,
  verifyEmailResendEmail,
} from '../lib/emailTemplates'
import {
  emailVerifyUrl, verifyEmailVerifyToken, extractTeacherIdFromVerifyToken,
} from '../services/emailVerification'
import { setEmailVerified } from '../db/queries/teachers'
import { findValidInviteByToken, markInviteAccepted } from '../db/queries/teacherInvites'
import { getInstitutionById, findInstitutionByEmailDomain, countInstitutionTeachers } from '../db/queries/institutions'
import { isInstitutionAdmin, assignDefaultDepartmentIfUnset } from '../db/queries/orgUnits'
import { verifyNudgeUnsubToken } from '../services/activation'
import { setNudgeEmailsEnabled } from '../db/queries/activation'
import { verifyMarketingUnsubToken } from '../services/marketingEmails'
import { setMarketingEmailsEnabled } from '../db/queries/teachers'
import { hasLeadershipRole } from '../db/queries/leadership'
import { getProgramAccessScope } from '../services/programAccess'
import { getAccessScope } from '../services/accessScope'
import { recordAudit } from '../db/queries/audit'

// Client metadata for auth audit rows. Auth routes are unauthenticated, so the
// catch-all auditLog middleware skips them (no req.teacher) — these events are
// recorded explicitly. UA capped to keep a hostile client from bloating the row.
function reqMeta(req: Request): { ipAddress: string | null; userAgent: string | null } {
  return {
    ipAddress: req.ip ?? null,
    userAgent: (req.get('user-agent') ?? '').slice(0, 400) || null,
  }
}

// Tree-derived admin signals exposed on the auth payload so the frontend route
// gates read authoritative org-tree state, not the legacy `teachers.role` enum.
// is_institution_admin = holds `admin` on the institution root unit (§7).
// is_leader = head/admin on any unit (or platform owner) — drives «Руководство»
// sidebar visibility without an extra round trip on every page load.
// program_access = scope class for «Образовательные программы» (Feature P
// role-driven feature access).
// curriculum_access = Research.md §7.10 Phase 1 — the 'curriculum' domain
// level ('admin'/'edit'/'view'/'none'), independent of is_institution_admin:
// a УМЦ head can hold curriculum access without being a root admin.
// teaching_access = Research.md §7.10 Phase 2 — same shape, 'teaching' domain
// (usage analytics, grading activity, leadership dashboards, roster read):
// a ПР УР can hold wide read-only teaching access without being a root admin.
// platform_access = Research.md §7.10 Phase 3 slice B — same shape, 'platform'
// domain (org tree CRUD, role grants — NOT invites/deactivation/settings,
// which stay root-admin-only): an institute director can hold admin access
// scoped to their own subtree without being a root admin.
async function adminFlags(row: { id: string; institution_id: string | null; is_platform_admin: boolean }) {
  const is_platform_admin = row.is_platform_admin ?? false
  const [is_institution_admin, has_role, program_scope, access_scope] = await Promise.all([
    row.institution_id ? isInstitutionAdmin(row.id, row.institution_id) : Promise.resolve(false),
    hasLeadershipRole(row.id, row.institution_id),
    getProgramAccessScope({ id: row.id, is_platform_admin, institution_id: row.institution_id }),
    getAccessScope({ id: row.id, is_platform_admin, institution_id: row.institution_id }),
  ])
  return {
    is_platform_admin,
    is_institution_admin,
    is_leader:         is_platform_admin || has_role,
    program_access:    program_scope.kind,
    curriculum_access: access_scope.curriculum?.level ?? 'none',
    teaching_access:   access_scope.teaching?.level ?? 'none',
    platform_access:   access_scope.platform?.level ?? 'none',
  }
}

const router = Router()

// ─── POST /api/auth/register ──────────────────────────────────────────────────

router.post(
  '/register',
  authLimiter,
  validate(registerRules),
  asyncHandler(async (req, res) => {
    const { email, password, name, university, phone, invite_token } = req.body as {
      email: string; password: string; name?: string; university?: string; phone?: string
      invite_token?: string
    }

    const existing = await findTeacherByEmail(email)
    if (existing) throw new ValidationError('Этот адрес эл. почты уже зарегистрирован')

    // Institution invite — attaches the new teacher to the institution.
    // Plan stays free per product decision; an admin upgrades seats separately.
    let institutionId: string | undefined
    let inviteId: string | undefined
    let inviteEmail: string | undefined
    if (invite_token) {
      const invite = await findValidInviteByToken(invite_token)
      if (invite) {
        institutionId = invite.institution_id
        inviteId = invite.id
        inviteEmail = invite.email
      }
      // An invalid/expired token is ignored — registration still succeeds as a normal teacher
    }

    // Email-domain auto-join — if no invite, place the teacher into an institution
    // that claims their email domain (respecting its seat cap).
    if (!institutionId) {
      const domain = email.split('@')[1]
      if (domain) {
        const inst = await findInstitutionByEmailDomain(domain)
        if (inst) {
          const hasSeat = inst.max_teachers == null || (await countInstitutionTeachers(inst.id)) < inst.max_teachers
          if (hasSeat) institutionId = inst.id
        }
      }
    }

    const passwordHash = await bcrypt.hash(password, 12)
    const teacher = await createTeacher(email, passwordHash, name, university, phone, institutionId)

    // Institution members get the default kafedra as their primary unit so
    // they're visible in leadership dashboards / structure headcounts from
    // day one; the admin refines placement on the structure page later.
    if (institutionId) await assignDefaultDepartmentIfUnset(teacher.id, institutionId)

    if (inviteId) await markInviteAccepted(inviteId)

    // Deferred email verification (migration 076) — never gates signup.
    // Registering through an admin invite whose email matches already proves
    // the address (the invite token arrived in that mailbox); everyone else
    // gets a verify link in the welcome email and an in-app banner.
    const verifiedViaInvite =
      !!inviteEmail && inviteEmail.toLowerCase() === teacher.email.toLowerCase()
    if (verifiedViaInvite) await setEmailVerified(teacher.id)

    const token = signToken({ id: teacher.id, email: teacher.email })

    // Welcome email — fire-and-forget
    if (name || email) {
      sendEmail({
        ...registrationEmail(
          name ?? email,
          verifiedViaInvite ? undefined : emailVerifyUrl(teacher.id, teacher.email)
        ),
        to: email,
      })
    }

    // Owner notification — fire-and-forget
    const adminTo = adminNotifyTo()
    if (adminTo) {
      sendEmail({ ...adminSignupEmail({ name, email, university, viaInvite: !!institutionId }), to: adminTo })
    }

    recordAudit({
      institutionId:  institutionId ?? null,
      actorTeacherId: teacher.id,
      actorEmail:     teacher.email,
      action:         'auth.register',
      metadata:       { viaInvite: !!inviteId, autoJoined: !!institutionId && !inviteId },
      ...reqMeta(req),
    })

    const plan = await buildPlanData(teacher.id, 'free', null)
    // `teacher` was materialised before setEmailVerified ran — patch the flag
    // rather than re-fetching the row for one field.
    res.status(201).json({
      token,
      teacher: { ...teacher, email_verified: teacher.email_verified || verifiedViaInvite },
      plan,
    })
  })
)

// ─── GET /api/auth/invite/:token ──────────────────────────────────────────────
// Public — lets the register page show who invited the teacher and prefill email.
router.get('/invite/:token', asyncHandler(async (req, res) => {
  const invite = await findValidInviteByToken(req.params.token)
  if (!invite) return res.json({ valid: false })
  const institution = await getInstitutionById(invite.institution_id)
  res.json({
    valid:            true,
    email:            invite.email,
    institution_name: institution?.name ?? null,
  })
}))

// ─── Shared HTML for email-link landing pages ─────────────────────────────────
// (unsubscribe + email verification). Corporate/university mail systems
// commonly run link-prefetching security scanners that GET every URL in an
// inbound email before the recipient ever opens it. A GET that mutates state
// gets silently triggered by the scanner, not the teacher. So GET only ever
// renders a page; the actual mutation is a same-origin POST the teacher
// triggers by clicking a button on that page.

function tokenActionResultPage(message: string): string {
  return `<html lang="ru"><body style="font-family:sans-serif;padding:40px">${escapeHtml(message)}</body></html>`
}

function tokenActionConfirmPage(params: { token: string; action: string; label: string }): string {
  return `<html lang="ru"><body style="font-family:sans-serif;padding:40px">
  <form method="POST" action="${escapeHtml(params.action)}">
    <input type="hidden" name="token" value="${escapeHtml(params.token)}">
    <button type="submit" style="font:inherit;padding:10px 20px;cursor:pointer">${escapeHtml(params.label)}</button>
  </form>
</body></html>`
}

// ─── GET/POST /api/auth/nudge-unsubscribe ──────────────────────────────────────
// Public — target of the «Отписаться» link in activation nudge emails. Token
// is a stateless HMAC over the teacher id (services/activation.ts), so links
// keep working indefinitely. GET only renders a confirm button (see comment
// above on mail-scanner prefetching); the POST it submits to does the mutation.
router.get('/nudge-unsubscribe', asyncHandler(async (req, res) => {
  const token = String(req.query.token ?? '')
  if (!verifyNudgeUnsubToken(token)) {
    res.status(400).send(tokenActionResultPage('Ссылка недействительна.'))
    return
  }
  res.send(tokenActionConfirmPage({
    token,
    action: '/api/auth/nudge-unsubscribe',
    label:  'Отписаться от подсказок по началу работы',
  }))
}))

router.post('/nudge-unsubscribe', asyncHandler(async (req, res) => {
  const token = String(req.body.token ?? '')
  const teacherId = verifyNudgeUnsubToken(token)
  if (!teacherId) {
    res.status(400).send(tokenActionResultPage('Ссылка недействительна.'))
    return
  }
  await setNudgeEmailsEnabled(teacherId, false)
  res.send(tokenActionResultPage('Вы отписаны от подсказок по началу работы. Письма о безопасности аккаунта и оплате продолжат приходить.'))
}))

// ─── GET/POST /api/auth/marketing-unsubscribe (token form) ────────────────────
// Public — target of the «Отписаться» link in one-off feature-announcement
// broadcasts (sent externally, not through emailTransport.ts). Distinct from
// nudge-unsubscribe above: a teacher may want onboarding tips but not feature
// announcements, or vice versa. Same stateless-HMAC token shape and the same
// GET-renders/POST-mutates split.
router.get('/marketing-unsubscribe', asyncHandler(async (req, res) => {
  const token = String(req.query.token ?? '')
  if (!verifyMarketingUnsubToken(token)) {
    res.status(400).send(tokenActionResultPage('Ссылка недействительна.'))
    return
  }
  res.send(tokenActionConfirmPage({
    token,
    action: '/api/auth/marketing-unsubscribe/confirm',
    label:  'Отписаться от писем о новых функциях',
  }))
}))

router.post('/marketing-unsubscribe/confirm', asyncHandler(async (req, res) => {
  const token = String(req.body.token ?? '')
  const teacherId = verifyMarketingUnsubToken(token)
  if (!teacherId) {
    res.status(400).send(tokenActionResultPage('Ссылка недействительна.'))
    return
  }
  await setMarketingEmailsEnabled(teacherId, false)
  res.send(tokenActionResultPage('Вы отписаны от писем о новых функциях. Письма о безопасности аккаунта и оплате продолжат приходить.'))
}))

// ─── GET/POST /api/auth/verify-email — deferred email verification ────────────
// Public — target of the «Подтвердить почту» link in the welcome / resend
// emails. Same GET-renders/POST-mutates split as the unsubscribe routes, and
// here the scanner concern is sharper: an auto-GET-verify would let a mail
// scanner "confirm" an account the mailbox owner never registered — exactly
// the pre-hijack window verification exists to close. The token's HMAC also
// covers the address, so links sent before an email change stop working.

async function resolveVerifyToken(token: string) {
  const claimedId = extractTeacherIdFromVerifyToken(token)
  if (!claimedId) return null
  const row = await findTeacherRowById(claimedId).catch(() => null)
  if (!row || !row.is_active) return null
  return verifyEmailVerifyToken(token, row.email) ? row : null
}

router.get('/verify-email', asyncHandler(async (req, res) => {
  const token = String(req.query.token ?? '')
  const row = await resolveVerifyToken(token)
  if (!row) {
    res.status(400).send(tokenActionResultPage('Ссылка недействительна.'))
    return
  }
  if (row.email_verified_at) {
    res.send(tokenActionResultPage('Адрес эл. почты уже подтверждён. Можно закрыть эту страницу.'))
    return
  }
  res.send(tokenActionConfirmPage({
    token,
    action: '/api/auth/verify-email/confirm',
    label:  'Подтвердить адрес эл. почты',
  }))
}))

router.post('/verify-email/confirm', asyncHandler(async (req, res) => {
  const token = String(req.body.token ?? '')
  const row = await resolveVerifyToken(token)
  if (!row) {
    res.status(400).send(tokenActionResultPage('Ссылка недействительна.'))
    return
  }
  await setEmailVerified(row.id)
  recordAudit({ institutionId: row.institution_id ?? null, actorTeacherId: row.id,
    actorEmail: row.email, action: 'auth.email_verified', ...reqMeta(req) })
  res.send(tokenActionResultPage('Адрес эл. почты подтверждён. Можно закрыть эту страницу и вернуться в ИСПУМ.'))
}))

// ─── POST /api/auth/resend-verification ───────────────────────────────────────
// Authenticated — the in-app banner's «Отправить ещё раз» button. Idempotent:
// already-verified accounts get the same ok response without a send.

router.post('/resend-verification', authenticate, authLimiter, asyncHandler(async (req, res) => {
  const row = await findTeacherRowById(req.teacher.id)
  if (!row) throw new NotFoundError('Пользователь')
  if (!row.email_verified_at) {
    sendEmail({
      ...verifyEmailResendEmail(row.name ?? row.email, emailVerifyUrl(row.id, row.email)),
      to: row.email,
    })
  }
  res.json({ ok: true })
}))

// ─── POST /api/auth/marketing-unsubscribe — by email ──────────────────────────
// Fallback for broadcasts sent through a tool that can't do per-recipient
// merge links (one static link for everyone) — target of a public frontend
// page where the teacher types their own email instead of clicking a
// pre-tokenised one. Public, rate-limited (same threat model as Contact/
// Research forms — unauthenticated, spam-prone). Always responds the same
// way regardless of whether the email is a registered teacher, so this can't
// be used to probe which addresses exist in the system.
router.post(
  '/marketing-unsubscribe',
  publicFormLimiter,
  validate(marketingUnsubscribeByEmailRules),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string }
    const teacher = await findTeacherByEmail(email)
    if (teacher) await setMarketingEmailsEnabled(teacher.id, false)
    res.json({ ok: true })
  })
)

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post(
  '/login',
  authLimiter,
  validate(loginRules),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string }

    const row = await findTeacherByEmail(email)
    if (!row) {
      recordAudit({ actorEmail: email, action: 'auth.login_failed',
        metadata: { reason: 'unknown_email' }, ...reqMeta(req) })
      throw new ValidationError('Неверный адрес эл. почты или пароль')
    }

    const valid = await bcrypt.compare(password, row.password_hash)
    if (!valid) {
      recordAudit({ institutionId: row.institution_id ?? null, actorTeacherId: row.id,
        actorEmail: row.email, action: 'auth.login_failed',
        metadata: { reason: 'bad_password' }, ...reqMeta(req) })
      throw new ValidationError('Неверный адрес эл. почты или пароль')
    }

    recordAudit({ institutionId: row.institution_id ?? null, actorTeacherId: row.id,
      actorEmail: row.email, action: 'auth.login', ...reqMeta(req) })

    const token = signToken({ id: row.id, email: row.email })

    // Effective tier (expiry + institution inheritance) — same helper the
    // authenticate middleware uses, so login and /me always agree.
    const effectiveTier = computeEffectiveTier(row)
    const plan = await buildPlanData(row.id, effectiveTier, row.plan_expires_at, row.auto_renew, row.renewal_failed_at)

    res.json({
      token,
      teacher: {
        id:                              row.id,
        email:                           row.email,
        name:                            row.name,
        university:                      row.university,
        role:                            row.role ?? 'teacher',
        institution_id:                  row.institution_id ?? null,
        institution_shared_rag_enabled:  row.institution_shared_rag_enabled ?? false,
        email_verified:                  row.email_verified_at != null,
        ...(await adminFlags(row)),
        created_at:                      row.created_at.toISOString(),
      },
      plan,
    })
  })
)

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

router.get('/me', authenticate, asyncHandler(async (req, res) => {
  const row = await findTeacherRowById(req.teacher.id)
  if (!row) throw new NotFoundError('Пользователь')

  const plan = await buildPlanData(row.id, req.teacher.plan_tier, row.plan_expires_at, row.auto_renew, row.renewal_failed_at)

  res.json({
    id:                              row.id,
    email:                           row.email,
    name:                            row.name,
    university:                      row.university,
    role:                            req.teacher.role,
    institution_id:                  row.institution_id ?? null,
    institution_shared_rag_enabled:  row.institution_shared_rag_enabled ?? false,
    email_verified:                  row.email_verified_at != null,
    ...(await adminFlags(row)),
    plan,
  })
}))

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────
// Always returns 200 — never reveal whether email exists (prevents enumeration).

router.post(
  '/forgot-password',
  authLimiter,
  validate(forgotPasswordRules),
  asyncHandler(async (req, res) => {
    const { email } = req.body as { email: string }

    const row = await findTeacherByEmail(email)

    if (row && row.is_active) {
      const rawToken = generateRawToken()
      const tokenHash = hashToken(rawToken)
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

      // Invalidate any previous tokens, then create the new one
      await invalidateExistingTokens(row.id)
      await createResetToken(row.id, tokenHash, expiresAt)

      const resetUrl =
        `${process.env.FRONTEND_URL ?? 'http://localhost:5173'}/reset-password?token=${rawToken}`

      sendEmail({
        ...passwordResetEmail(row.name ?? row.email, resetUrl),
        to: row.email,
      })

      recordAudit({ institutionId: row.institution_id ?? null, actorTeacherId: row.id,
        actorEmail: row.email, action: 'auth.password_reset_requested', ...reqMeta(req) })
    }

    // Always the same response — never say "email not found"
    res.json({ message: 'Если этот адрес зарегистрирован, письмо со ссылкой отправлено.' })
  })
)

// ─── POST /api/auth/reset-password ───────────────────────────────────────────

router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordRules),
  asyncHandler(async (req, res) => {
    const { token: rawToken, password } = req.body as {
      token: string; password: string
    }

    const tokenHash = hashToken(rawToken)
    const record = await findValidToken(tokenHash)

    if (!record) {
      throw new ValidationError('Ссылка для сброса пароля недействительна или устарела.')
    }

    const newHash = await bcrypt.hash(password, 12)

    // Update password + mark token used in parallel
    await Promise.all([
      updateTeacherPassword(record.teacher_id, newHash),
      markTokenUsed(record.id),
    ])

    // Confirmation email — fire-and-forget
    const teacher = await findTeacherRowById(record.teacher_id)
    if (teacher) {
      sendEmail({
        ...passwordChangedEmail(teacher.name ?? teacher.email),
        to: teacher.email,
      })
    }

    recordAudit({ institutionId: teacher?.institution_id ?? null, actorTeacherId: record.teacher_id,
      actorEmail: teacher?.email ?? null, action: 'auth.password_reset_completed', ...reqMeta(req) })

    res.json({ message: 'Пароль успешно изменён. Теперь вы можете войти.' })
  })
)

export default router

// ─── Helper ───────────────────────────────────────────────────────────────────

async function buildPlanData(
  teacherId: string,
  planTier: string,
  planExpiresAt: Date | null,
  autoRenew = false,
  renewalFailedAt: Date | null = null,
) {
  const tier    = planTier ?? 'free'
  const limits  = getLimits(tier)
  const counter = await getOrCreateCounter(teacherId)

  const currentMonth      = new Date().toISOString().slice(0, 7)
  const gradesUsed        = counter.month_year === currentMonth ? counter.grades_this_month        : 0
  const presentationsUsed = counter.month_year === currentMonth ? counter.presentations_this_month : 0
  // Topics + quizzes use count-based limits (no pre-aggregated counter)
  const topicsUsed        = limits.topicsPerMonth  === Infinity ? 0 : await countTopicsThisMonth(teacherId)
  const quizzesUsed       = limits.quizzesPerMonth === Infinity ? 0 : await countQuizzesThisMonth(teacherId)

  return {
    tier,
    expiresAt:          planExpiresAt?.toISOString() ?? null,
    autoRenew,
    renewalFailedAt:    renewalFailedAt?.toISOString() ?? null,
    gradesUsed,
    gradesLimit:        limits.gradesPerMonth        === Infinity ? null : limits.gradesPerMonth,
    presentationsUsed,
    presentationsLimit: limits.presentationsPerMonth === Infinity ? null : limits.presentationsPerMonth,
    topicsUsed,
    topicsLimit:        limits.topicsPerMonth  === Infinity ? null : limits.topicsPerMonth,
    quizzesUsed,
    quizzesLimit:       limits.quizzesPerMonth === Infinity ? null : limits.quizzesPerMonth,
    features: {
      documentUpload:        canUseFeature(tier, 'documentUpload'),
      ragFlywheel:           canUseFeature(tier, 'ragFlywheel'),
      emailGeneration:       canUseFeature(tier, 'emailGeneration'),
      presentationHistory:   canUseFeature(tier, 'presentationHistory'),
      confidenceCheck:       canUseFeature(tier, 'confidenceCheck'),
      verificationQuestions: canUseFeature(tier, 'verificationQuestions'),
      handout:               canUseFeature(tier, 'handout'),
      publishedAssignments:  canUseFeature(tier, 'publishedAssignments'),
      feedbackCritic:        canUseFeature(tier, 'feedbackCritic'),
      cohortSynthesis:       canUseFeature(tier, 'cohortSynthesis'),
      calcVerification:      canUseFeature(tier, 'calcVerification'),
      citationCheck:         canUseFeature(tier, 'citationCheck'),
      challengeFeedback:     canUseFeature(tier, 'challengeFeedback'),
      rpdMonitor:            canUseFeature(tier, 'rpdMonitor'),
    },
  }
}
