import { Router } from 'express'
import { authenticate } from '../middleware/authenticate'
import { requireInstitutionAdmin } from '../middleware/requireRole'
import { validate } from '../middleware/validate'
import { asyncHandler } from '../lib/asyncHandler'
import { ValidationError, NotFoundError } from '../errors/AppError'
import { inviteRules, bulkInviteRules } from '../validation/institutionValidation'
import { createCriterionRules } from '../validation/criteriaValidation'
import { createRubricRules } from '../validation/rubricsValidation'
import {
  getInstitutionById, getInstitutionOverview, getInstitutionDailyUsage,
  listInstitutionTeachers, setInstitutionTeacherActive, countInstitutionTeachers,
  getInstitutionDocumentFetchDomains, setInstitutionDocumentFetchDomains,
} from '../db/queries/institutions'
import { normalizeDomain } from '../services/documentFetch'
import {
  createInvite, listPendingInvites, deleteInvite, findActiveInviteForEmail,
  markInviteEmailStatus,
} from '../db/queries/teacherInvites'
import { findTeacherByEmail, findTeacherById } from '../db/queries/teachers'
import { findCriteriaByInstitution, createCriterion, findCriteriaByIds, shareCriterion } from '../db/queries/criteria'
import { findRubricsByInstitution, createInstitutionRubric, shareRubric } from '../db/queries/rubrics'
import { getSharedRagSummary, setInstitutionSharedRag } from '../db/queries/sharedRag'
import { invalidateInstitutionProviderCache } from '../services/llm/institutionResolver'
import { pool } from '../db/connection'
import { recordAudit, listAuditByInstitution } from '../db/queries/audit'
import { generateRawToken } from '../db/queries/passwordReset'
import { sendEmail } from '../services/emailTransport'
import { teacherInviteEmail } from '../lib/emailTemplates'
import { toCsv, csvFilename } from '../lib/csv'
import axios from 'axios'
import { getLtiConfig, setLtiConfig, isLtiConfigComplete } from '../db/queries/institutions'
import { loginInitUrl, launchCallbackUrl, jwksUrl as toolJwksUrl, createRegistrationSession, registrationInitUrl } from '../services/lti'
import { listLtiCourseLinksForInstitution, setLtiCourseLinkOrgUnit } from '../db/queries/ltiCourseLinks'
import { getOrgUnitById, getRootUnitForInstitution } from '../db/queries/orgUnits'
import type { CriterionSubject, RubricItem } from '../../../shared/types'

const router = Router()
router.use(authenticate)
router.use(requireInstitutionAdmin)
// This router records its own rich audit rows (recordAudit calls below) — opt
// out of the catch-all auditLog middleware. Any new mutation here MUST call
// recordAudit or it will go unlogged.
router.use((_req, res, next) => { res.locals.selfAudited = true; next() })

// Every handler is scoped to the admin's own institution — never trust a body value.
function institutionId(req: { teacher: { institution_id: string | null } }): string {
  const id = req.teacher.institution_id
  if (!id) throw new ValidationError('Ваш аккаунт не привязан к организации')
  return id
}

// ─── Overview ──────────────────────────────────────────────────────────────────

router.get('/overview', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const [institution, overview] = await Promise.all([
    getInstitutionById(id),
    getInstitutionOverview(id),
  ])
  res.json({
    institution: institution ? { id: institution.id, name: institution.name, plan_tier: institution.plan_tier, max_teachers: institution.max_teachers } : null,
    ...overview,
  })
}))

// ─── Usage (tokens + counts only — never cost) ────────────────────────────────

router.get('/usage/daily', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt((req.query.days as string) ?? '30', 10) || 30, 365)
  res.json(await getInstitutionDailyUsage(institutionId(req), days))
}))

// ─── Teachers ──────────────────────────────────────────────────────────────────

router.get('/teachers', asyncHandler(async (req, res) => {
  res.json(await listInstitutionTeachers(institutionId(req)))
}))

// institution_admin may only toggle active state — not role or plan
router.patch('/teachers/:id', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const { isActive } = req.body as { isActive?: boolean }
  if (typeof isActive !== 'boolean') throw new ValidationError('Ожидается поле isActive')
  if (req.params.id === req.teacher.id) throw new ValidationError('Нельзя деактивировать собственный аккаунт')

  const ok = await setInstitutionTeacherActive(req.params.id, id, isActive)
  if (!ok) throw new NotFoundError('Преподаватель')
  recordAudit({ institutionId: id, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: isActive ? 'teacher.activated' : 'teacher.deactivated', target: req.params.id })
  res.json({ ok: true })
}))

// ─── Invites ─────────────────────────────────────────────────────────────────

router.get('/teachers/invites', asyncHandler(async (req, res) => {
  const invites = await listPendingInvites(institutionId(req))
  // Never expose the raw token in a list response
  res.json(invites.map((i) => ({ id: i.id, email: i.email, expires_at: i.expires_at, created_at: i.created_at })))
}))

router.post('/teachers/invite', validate(inviteRules), asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const { email } = req.body as { email: string }

  const institution = await getInstitutionById(id)
  if (!institution) throw new NotFoundError('Организация')

  // Already a member?
  const existing = await findTeacherByEmail(email)
  if (existing?.institution_id === id) throw new ValidationError('Этот преподаватель уже в вашей организации')

  // Seat cap (max_teachers includes pending invites is out of scope — count members only)
  if (institution.max_teachers != null) {
    const count = await countInstitutionTeachers(id)
    if (count >= institution.max_teachers) {
      throw new ValidationError(`Достигнут лимит мест (${institution.max_teachers}). Обратитесь в поддержку для расширения.`)
    }
  }

  // Reuse an existing pending invite if present (idempotent-ish), else create one
  let invite = await findActiveInviteForEmail(id, email)
  if (!invite) {
    const token = generateRawToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    invite = await createInvite({ institutionId: id, invitedBy: req.teacher.id, email, token, expiresAt })
  }

  const inviteUrl = `${process.env.FRONTEND_URL ?? ''}/register?invite=${invite.token}`
  const inviter = await findTeacherById(req.teacher.id)
  const inviterName = inviter?.name ?? req.teacher.email

  // Await delivery so the panel reflects the real outcome on its next fetch.
  // Send result errors are already logged inside sendEmail; we just record on
  // the invite row so the admin sees the status without SSH'ing into a VM.
  const send = await sendEmail({ ...teacherInviteEmail(inviterName, institution.name, inviteUrl), to: email })
  await markInviteEmailStatus(invite.id, send.ok, send.ok ? null : (send.error ?? 'unknown'))

  recordAudit({ institutionId: id, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'teacher.invited', target: email })

  res.status(201).json({
    id: invite.id, email: invite.email, expires_at: invite.expires_at,
    email_delivered: send.ok, email_error: send.ok ? null : (send.error ?? null),
  })
}))

// Bulk invite — paste many addresses at once (CSV-style onboarding).
router.post('/teachers/invite-bulk', validate(bulkInviteRules), asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const { emails } = req.body as { emails: string[] }

  const institution = await getInstitutionById(id)
  if (!institution) throw new NotFoundError('Организация')

  const unique = Array.from(new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean)))
  const inviter = await findTeacherById(req.teacher.id)
  const inviterName = inviter?.name ?? req.teacher.email

  // Seat budget counts current members + outstanding invites (NULL cap = unlimited).
  let available = Infinity
  if (institution.max_teachers != null) {
    const [members, pending] = await Promise.all([countInstitutionTeachers(id), listPendingInvites(id)])
    available = Math.max(0, institution.max_teachers - members - pending.length)
  }

  const invited: string[] = []
  const skipped: Array<{ email: string; reason: string }> = []

  for (const email of unique) {
    const existing = await findTeacherByEmail(email)
    if (existing?.institution_id === id) { skipped.push({ email, reason: 'уже в организации' }); continue }

    const already = await findActiveInviteForEmail(id, email)
    if (already) { skipped.push({ email, reason: 'приглашение уже отправлено' }); continue }

    if (available <= 0) { skipped.push({ email, reason: 'нет свободных мест' }); continue }

    const token = generateRawToken()
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    const invite = await createInvite({ institutionId: id, invitedBy: req.teacher.id, email, token, expiresAt })
    available -= 1

    const inviteUrl = `${process.env.FRONTEND_URL ?? ''}/register?invite=${invite.token}`
    const send = await sendEmail({ ...teacherInviteEmail(inviterName, institution.name, inviteUrl), to: email })
    await markInviteEmailStatus(invite.id, send.ok, send.ok ? null : (send.error ?? 'unknown'))
    invited.push(email)
  }

  if (invited.length) {
    recordAudit({ institutionId: id, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
      action: 'teacher.bulk_invited', metadata: { invited: invited.length, skipped: skipped.length } })
  }
  res.status(201).json({ invited: invited.length, skipped })
}))

router.delete('/teachers/invite/:id', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const ok = await deleteInvite(req.params.id, id)
  if (!ok) throw new NotFoundError('Приглашение')
  recordAudit({ institutionId: id, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'teacher.invite_revoked', target: req.params.id })
  res.json({ ok: true })
}))

// ─── Audit log ─────────────────────────────────────────────────────────────────

router.get('/audit', asyncHandler(async (req, res) => {
  const limit = Math.min(parseInt((req.query.limit as string) ?? '100', 10) || 100, 500)
  res.json(await listAuditByInstitution(institutionId(req), limit))
}))

// ─── CSV usage export (units only — never cost) ──────────────────────────────

router.get('/usage/export', asyncHandler(async (req, res) => {
  const days = Math.min(parseInt((req.query.days as string) ?? '90', 10) || 90, 365)
  const rows = await getInstitutionDailyUsage(institutionId(req), days)
  const csv = toCsv(
    ['Дата', 'Проверок', 'Презентаций', 'Токенов'],
    rows.map((r) => [r.date, r.grade_count, r.presentation_count, r.total_tokens])
  )
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${csvFilename('ispum_usage')}"`)
  res.send(csv)
}))

// ─── Shared criteria ───────────────────────────────────────────────────────────

router.get('/criteria', asyncHandler(async (req, res) => {
  res.json(await findCriteriaByInstitution(institutionId(req)))
}))

router.post('/criteria', validate(createCriterionRules), asyncHandler(async (req, res) => {
  institutionId(req) // ensure scoped
  const { name, description, course_id, subject } = req.body as {
    name: string; description?: string; course_id?: string; subject?: CriterionSubject
  }
  // Shared across the institution → visible in every member's grading picker.
  const criterion = await createCriterion(req.teacher.id, { name, description, course_id, subject })
  const root = await getRootUnitForInstitution(institutionId(req))
  const shared = root ? await shareCriterion(criterion.id, req.teacher.id, root.id) : criterion
  recordAudit({ institutionId: req.teacher.institution_id, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'criterion.shared_created', target: name })
  res.status(201).json(shared)
}))

// ─── Shared rubrics ────────────────────────────────────────────────────────────

router.get('/rubrics', asyncHandler(async (req, res) => {
  res.json(await findRubricsByInstitution(institutionId(req)))
}))

router.post('/rubrics', validate(createRubricRules), asyncHandler(async (req, res) => {
  institutionId(req) // ensure scoped
  const { name, description, subject, items } = req.body as {
    name: string; description?: string; subject?: CriterionSubject; items: RubricItem[]
  }
  // Weights must sum to 100 and every criterion must be one the admin can use
  // (own + their institution's shared + global). The author becomes the row's
  // teacher_id; is_institution_shared = TRUE so all members see it.
  const total = items.reduce((s, it) => s + it.weight, 0)
  if (total !== 100) {
    throw new ValidationError(`Сумма весов критериев должна быть 100% (сейчас ${total}%)`)
  }
  const ids = items.map((it) => it.criterion_id)
  if (new Set(ids).size !== ids.length) {
    throw new ValidationError('Критерии в рубрике не должны повторяться')
  }
  const resolved = await findCriteriaByIds(ids, req.teacher.id, req.teacher.institution_id ?? null)
  if (resolved.length !== new Set(ids).size) {
    throw new ValidationError('Один или несколько критериев недоступны')
  }
  const rubric = await createInstitutionRubric(req.teacher.id, { name, description, subject, items })
  const root = await getRootUnitForInstitution(institutionId(req))
  const shared = root ? await shareRubric(rubric.id, req.teacher.id, root.id) : rubric
  recordAudit({ institutionId: req.teacher.institution_id, actorTeacherId: req.teacher.id, actorEmail: req.teacher.email,
    action: 'rubric.shared_created', target: name })
  res.status(201).json(shared)
}))

// ─── Shared RAG flywheel (kafedra-wide loop) ──────────────────────────────────

router.get('/shared-rag', asyncHandler(async (req, res) => {
  res.json(await getSharedRagSummary(institutionId(req)))
}))

// ─── Model sovereignty (Phase 4) ──────────────────────────────────────────────
//
// GET surfaces the current preferred provider + breakdown of recent grades by
// provider (so the admin can see the practical impact of any past switch).
// PATCH validates against the known providers and audits the change.

router.get('/model', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const [prefRows, statRows] = await Promise.all([
    pool.query<{ preferred_provider: string | null }>(
      `SELECT preferred_provider FROM institutions WHERE id = $1`,
      [id]
    ),
    pool.query<{ ai_provider: string | null; n: string }>(
      `SELECT ai_provider, COUNT(*) AS n
         FROM assignments a
         JOIN teachers t ON t.id = a.teacher_id
        WHERE t.institution_id = $1
          AND a.status = 'approved'
          AND a.approved_at >= NOW() - INTERVAL '30 days'
        GROUP BY ai_provider
        ORDER BY n DESC`,
      [id]
    ),
  ])
  res.json({
    preferred_provider:  prefRows.rows[0]?.preferred_provider ?? null,
    by_provider_30d:     statRows.rows.map((r) => ({
      provider: r.ai_provider,
      n:        Number(r.n),
    })),
  })
}))

router.patch('/model', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const { provider } = req.body as { provider?: string | null }
  const allowed: Array<string | null> = ['deepseek', 'yandex', null]
  if (!(allowed as Array<string | null>).includes(provider ?? null)) {
    throw new ValidationError('Допустимы значения: deepseek, yandex, или null (по умолчанию).')
  }
  await pool.query(
    `UPDATE institutions SET preferred_provider = $2 WHERE id = $1`,
    [id, provider ?? null]
  )
  invalidateInstitutionProviderCache(id)
  recordAudit({
    institutionId:    id,
    actorTeacherId:   req.teacher.id,
    actorEmail:       req.teacher.email,
    action:           'model.preferred_provider_changed',
    target:           provider ?? 'default',
  })
  res.json({ preferred_provider: provider ?? null })
}))

router.patch('/shared-rag', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const { enabled } = req.body as { enabled?: boolean }
  if (typeof enabled !== 'boolean') {
    throw new ValidationError('enabled должен быть true или false')
  }
  await setInstitutionSharedRag(id, enabled)
  recordAudit({
    institutionId:    id,
    actorTeacherId:   req.teacher.id,
    actorEmail:       req.teacher.email,
    action:           enabled ? 'shared_rag.enabled' : 'shared_rag.disabled',
    target:           '',
  })
  res.json(await getSharedRagSummary(id))
}))

// ─── Document-URL fetch allowlist (migration 085) ─────────────────────────────
//
// Governs the "upload document by pasting a link" feature: the server only
// fetches from these domains (subdomains allowed). Managed here by the
// institution admin — deliberately decoupled from email_domain (auto-join).
// The effective allowlist at fetch time also folds in DOCUMENT_FETCH_ALLOWED_
// DOMAINS (a platform-wide env supplement) — that's not shown/editable here.

const MAX_DOCUMENT_DOMAINS = 25

router.get('/document-domains', asyncHandler(async (req, res) => {
  res.json({ domains: await getInstitutionDocumentFetchDomains(institutionId(req)) })
}))

router.patch('/document-domains', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const raw = (req.body as { domains?: unknown }).domains
  if (!Array.isArray(raw)) throw new ValidationError('domains должен быть массивом строк')
  if (raw.length > MAX_DOCUMENT_DOMAINS) {
    throw new ValidationError(`Слишком много доменов (максимум ${MAX_DOCUMENT_DOMAINS}).`)
  }

  // Normalise each entry to a bare hostname; reject anything that isn't a
  // plausible domain so a typo doesn't silently disappear.
  const seen = new Set<string>()
  const domains: string[] = []
  for (const entry of raw) {
    const norm = normalizeDomain(String(entry ?? ''))
    if (!norm) throw new ValidationError(`Некорректный домен: «${String(entry).slice(0, 60)}». Укажите домен вида kstu.ru.`)
    if (!seen.has(norm)) { seen.add(norm); domains.push(norm) }
  }

  await setInstitutionDocumentFetchDomains(id, domains)
  recordAudit({
    institutionId:  id,
    actorTeacherId: req.teacher.id,
    actorEmail:     req.teacher.email,
    action:         'document_domains.updated',
    target:         domains.join(', '),
  })
  res.json({ domains })
}))

// ─── LTI 1.3 platform registration (Settings → Organisation → LTI) ────────────
// Self-serve config, unlike SAML which platform-admin edits on the customer's
// behalf (Research.md §6.5) — LTI setup is comparatively high-friction and
// self-service-critical for institutional sales, so it gets its own gate here
// rather than mirroring the SAML admin-panel location.

router.get('/lti', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const cfg = await getLtiConfig(id)
  if (!cfg) throw new NotFoundError('Организация')
  res.json({
    ...cfg,
    complete:   isLtiConfigComplete(cfg),
    login_url:  loginInitUrl(),
    launch_url: launchCallbackUrl(),
    jwks_url:   toolJwksUrl(),
    // ^ tool_jwks_url is the URL WE publish (for the admin to paste into
    // Moodle); lti_platform_jwks_url in `cfg` above is the platform's own.
  })
}))

router.put('/lti', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const body = req.body as Partial<{
    lti_enabled: boolean
    lti_platform_issuer: string | null
    lti_platform_client_id: string | null
    lti_platform_deployment_ids: string[]
    lti_platform_auth_login_url: string | null
    lti_platform_auth_token_url: string | null
    lti_platform_jwks_url: string | null
  }>

  if (body.lti_platform_deployment_ids !== undefined && !Array.isArray(body.lti_platform_deployment_ids)) {
    throw new ValidationError('lti_platform_deployment_ids должен быть массивом строк')
  }

  const updated = await setLtiConfig(id, body)
  if (!updated) throw new NotFoundError('Организация')

  recordAudit({
    institutionId:  id,
    actorTeacherId: req.teacher.id,
    actorEmail:     req.teacher.email,
    action:         'lti.config_updated',
    target:         '',
  })
  res.json({ ...updated, complete: isLtiConfigComplete(updated) })
}))

// Synthetic diagnostic — no live launch to test against, so this checks the
// one thing that's independently verifiable without the platform initiating
// anything: that the registered JWKS URL is reachable and actually serves a
// JWK set. Catches the most common setup mistake (wrong/unreachable URL)
// before the admin's first real launch attempt.
router.post('/lti/test-connection', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const cfg = await getLtiConfig(id)
  if (!cfg?.lti_platform_jwks_url) {
    res.json({ ok: false, message: 'Укажите URL JWKS платформы перед проверкой соединения.' })
    return
  }

  try {
    const response = await axios.get(cfg.lti_platform_jwks_url, { timeout: 5000 })
    const keys = (response.data as { keys?: unknown[] })?.keys
    if (!Array.isArray(keys) || keys.length === 0) {
      res.json({ ok: false, message: 'URL JWKS доступен, но не содержит ключей.' })
      return
    }
    res.json({ ok: true, message: `Соединение успешно — получено ${keys.length} ключ(ей).` })
  } catch (err) {
    res.json({
      ok: false,
      message: `Не удалось подключиться к URL JWKS: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}))

// Generates a one-time link the admin pastes into Moodle's own "Dynamic
// registration" screen — Moodle then navigates to it, appending its own
// openid_configuration + registration_token query params (routes/lti.ts
// GET /register handles that side of the handshake).
router.get('/lti/registration-link', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const sessionId = await createRegistrationSession(id)
  res.json({ url: registrationInitUrl(sessionId) })
}))

// ─── Course mapping — Moodle context ↔ org_unit ────────────────────────────────
// Purely informational for institutional reporting rollups. An unmapped link
// never blocks a teacher from grading — course auto-creation already
// happened at first launch (db/queries/ltiCourseLinks.ts).

router.get('/lti/course-links', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  res.json({ links: await listLtiCourseLinksForInstitution(id) })
}))

router.put('/lti/course-links/:id', asyncHandler(async (req, res) => {
  const id = institutionId(req)
  const { org_unit_id } = req.body as { org_unit_id?: string | null }

  if (org_unit_id) {
    const unit = await getOrgUnitById(org_unit_id)
    if (!unit || unit.institution_id !== id) {
      throw new ValidationError('Раздел оргструктуры не найден в этой организации')
    }
  }

  const updated = await setLtiCourseLinkOrgUnit(req.params.id, id, org_unit_id ?? null)
  if (!updated) throw new NotFoundError('Сопоставление курса')

  recordAudit({
    institutionId:  id,
    actorTeacherId: req.teacher.id,
    actorEmail:     req.teacher.email,
    action:         'lti.course_link_mapped',
    target:         req.params.id,
  })
  res.json(updated)
}))

export default router
