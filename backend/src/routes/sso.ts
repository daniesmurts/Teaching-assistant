import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authLimiter } from '../middleware/rateLimits'
import { signToken } from '../lib/jwt'
import { setSessionCookie } from '../lib/session'
import { logger } from '../lib/logger'
import { AppError, ValidationError } from '../errors/AppError'
import {
  buildSamlForInstitution, generateSpMetadata,
  extractAttribute, EMAIL_FALLBACK_ATTRS, NAME_FALLBACK_ATTRS,
} from '../services/saml'
import {
  getSamlConfig, findSamlConfigForEmailDomain, isSamlConfigComplete,
} from '../db/queries/institutions'
import { findOrCreateSamlTeacher } from '../db/queries/teachers'

const router = Router()

// ─── POST /api/sso/discover ───────────────────────────────────────────────────
// Called by the login page after the teacher types their email. Returns
// either { method: 'saml', loginUrl, institutionName } or { method: 'password' }.
// Never reveals whether the email belongs to a registered account — only
// whether the *domain* is configured for SSO.

router.post('/discover', authLimiter, asyncHandler(async (req, res) => {
  const email = String((req.body as { email?: string }).email ?? '').trim().toLowerCase()
  if (!email || !email.includes('@')) {
    throw new ValidationError('Введите корректный адрес эл. почты')
  }

  const domain = email.split('@')[1]
  if (!domain) {
    res.json({ method: 'password' })
    return
  }

  const disco = await findSamlConfigForEmailDomain(domain)
  if (!disco || !isSamlConfigComplete(disco)) {
    res.json({ method: 'password' })
    return
  }

  res.json({
    method:          'saml',
    institutionId:   disco.institution_id,
    institutionName: disco.institution_name,
    loginUrl:        `/api/sso/${disco.institution_id}/login`,
  })
}))

// ─── GET /api/sso/:institutionId/metadata ─────────────────────────────────────
// Public — the IdP admin downloads this XML and uploads it on their side.
// Returned even when SAML isn't yet fully configured so admins can pre-share
// metadata while setting up.

router.get('/:institutionId/metadata', asyncHandler(async (req, res) => {
  const xml = generateSpMetadata(req.params.institutionId)
  res.type('application/xml').send(xml)
}))

// ─── GET /api/sso/:institutionId/login ────────────────────────────────────────
// Initiate SAML — build an AuthnRequest and 302 to the IdP. RelayState
// carries an optional return path so the user lands where they meant to go.

router.get('/:institutionId/login', asyncHandler(async (req, res) => {
  const cfg = await getSamlConfig(req.params.institutionId)
  if (!cfg || !isSamlConfigComplete(cfg)) {
    throw new AppError('SSO не настроен для этой организации', 404, 'SAML_NOT_CONFIGURED')
  }

  const saml = buildSamlForInstitution(req.params.institutionId, cfg)
  const relayState = typeof req.query.next === 'string' ? req.query.next : ''
  const url = await saml.getAuthorizeUrlAsync(relayState, undefined, {})
  res.redirect(url)
}))

// ─── POST /api/sso/:institutionId/acs ─────────────────────────────────────────
// Assertion Consumer Service — the IdP posts the SAMLResponse here as
// application/x-www-form-urlencoded after the user authenticates. We verify
// the signature, JIT-provision the teacher, mint our JWT, and hand it to
// the frontend via the /sso/callback page.

router.post('/:institutionId/acs', asyncHandler(async (req, res) => {
  const cfg = await getSamlConfig(req.params.institutionId)
  if (!cfg || !isSamlConfigComplete(cfg)) {
    throw new AppError('SSO не настроен для этой организации', 404, 'SAML_NOT_CONFIGURED')
  }

  const samlResponse = (req.body as { SAMLResponse?: string }).SAMLResponse
  if (!samlResponse) {
    throw new ValidationError('Отсутствует SAMLResponse')
  }

  const saml = buildSamlForInstitution(req.params.institutionId, cfg)

  let profile: Record<string, unknown> | null = null
  try {
    const result = await saml.validatePostResponseAsync({ SAMLResponse: samlResponse })
    profile = result.profile as Record<string, unknown> | null
  } catch (err) {
    logger.warn({
      message:       'SAML assertion validation failed',
      institutionId: req.params.institutionId,
      error:         err instanceof Error ? err.message : String(err),
    })
    throw new AppError('Не удалось проверить ответ SSO', 400, 'SAML_VALIDATION_FAILED')
  }

  if (!profile) {
    throw new AppError('Ответ SSO не содержит данных пользователя', 400, 'SAML_NO_PROFILE')
  }

  // Attribute extraction. node-saml flattens the assertion's AttributeStatement
  // into the top level of `profile`, alongside protocol fields like nameID.
  const attributes = profile as Record<string, unknown>
  const email = extractAttribute(attributes, cfg.saml_attribute_email, EMAIL_FALLBACK_ATTRS)
  const name  = extractAttribute(attributes, cfg.saml_attribute_name,  NAME_FALLBACK_ATTRS)
  const nameID = typeof attributes.nameID === 'string' ? attributes.nameID : null

  if (!email) {
    logger.warn({
      message:       'SAML assertion missing email',
      institutionId: req.params.institutionId,
      configuredAttr: cfg.saml_attribute_email,
      // Don't log the full assertion — may contain PII — only the attribute keys.
      keys: Object.keys(attributes).filter(k => !k.startsWith('_')),
    })
    throw new AppError(
      'В ответе SSO не найден адрес эл. почты. Обратитесь к администратору.',
      400, 'SAML_NO_EMAIL'
    )
  }

  const teacher = await findOrCreateSamlTeacher({
    email,
    name:          name,
    institutionId: req.params.institutionId,
    samlSubject:   nameID ?? email,
  })

  if (!teacher.is_active) {
    throw new AppError('Аккаунт деактивирован', 403, 'ACCOUNT_DISABLED')
  }

  const { token } = signToken({ id: teacher.id, email: teacher.email })
  setSessionCookie(res, token)

  // RelayState may carry a relative return path (e.g. /app/dashboard). Only
  // accept relative paths — never honour an external URL passed via SSO.
  const relayState = typeof (req.body as { RelayState?: string }).RelayState === 'string'
    ? (req.body as { RelayState: string }).RelayState
    : ''
  const safeNext = relayState && relayState.startsWith('/') && !relayState.startsWith('//')
    ? relayState
    : ''

  const frontend = process.env.FRONTEND_URL ?? 'http://localhost:5173'
  const callbackUrl = new URL('/sso/callback', frontend)
  if (safeNext) callbackUrl.searchParams.set('next', safeNext)
  res.redirect(callbackUrl.toString())
}))

export default router
