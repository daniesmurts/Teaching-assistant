import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { authenticate } from '../middleware/authenticate'
import { validate } from '../middleware/validate'
import { authLimiter } from '../middleware/rateLimits'
import { asyncHandler } from '../lib/asyncHandler'
import { signToken } from '../lib/jwt'
import { ValidationError, NotFoundError } from '../errors/AppError'
import {
  registerRules, loginRules, forgotPasswordRules, resetPasswordRules,
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
} from '../lib/emailTemplates'
import { findValidInviteByToken, markInviteAccepted } from '../db/queries/teacherInvites'
import { getInstitutionById, findInstitutionByEmailDomain, countInstitutionTeachers } from '../db/queries/institutions'
import { isInstitutionAdmin } from '../db/queries/orgUnits'

// Tree-derived admin signals exposed on the auth payload so the frontend route
// gates read authoritative org-tree state, not the legacy `teachers.role` enum.
// is_institution_admin = holds `admin` on the institution root unit (§7).
async function adminFlags(row: { id: string; institution_id: string | null; is_platform_admin: boolean }) {
  return {
    is_platform_admin:    row.is_platform_admin ?? false,
    is_institution_admin: row.institution_id ? await isInstitutionAdmin(row.id, row.institution_id) : false,
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
    if (invite_token) {
      const invite = await findValidInviteByToken(invite_token)
      if (invite) {
        institutionId = invite.institution_id
        inviteId = invite.id
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

    if (inviteId) await markInviteAccepted(inviteId)

    const token = signToken({ id: teacher.id, email: teacher.email })

    // Welcome email — fire-and-forget
    if (name || email) {
      sendEmail({ ...registrationEmail(name ?? email), to: email })
    }

    // Owner notification — fire-and-forget
    const adminTo = adminNotifyTo()
    if (adminTo) {
      sendEmail({ ...adminSignupEmail({ name, email, university, viaInvite: !!institutionId }), to: adminTo })
    }

    const plan = await buildPlanData(teacher.id, 'free', null)
    res.status(201).json({ token, teacher, plan })
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

// ─── POST /api/auth/login ─────────────────────────────────────────────────────

router.post(
  '/login',
  authLimiter,
  validate(loginRules),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as { email: string; password: string }

    const row = await findTeacherByEmail(email)
    if (!row) throw new ValidationError('Неверный адрес эл. почты или пароль')

    const valid = await bcrypt.compare(password, row.password_hash)
    if (!valid) throw new ValidationError('Неверный адрес эл. почты или пароль')

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
    },
  }
}
