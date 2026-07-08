import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { authenticate } from '../middleware/authenticate'
import { ltiLimiter } from '../middleware/rateLimits'
import { signToken } from '../lib/jwt'
import { logger } from '../lib/logger'
import { AppError, ValidationError, NotFoundError } from '../errors/AppError'
import { toolPublicJwks } from '../lib/ltiJwks'
import {
  loginInitUrl, launchCallbackUrl, createLaunchState, consumeLaunchState,
  validateLaunchToken, isInstructorRole, isLearnerRole,
  mintDeepLinkingResponse, type DeepLinkContentItem,
  consumeRegistrationSession, fetchPlatformOpenIdConfiguration, registerWithPlatform,
} from '../services/lti'
import { getLtiConfig, setLtiConfig, findLtiConfigForIssuer, isLtiConfigComplete } from '../db/queries/institutions'
import { findOrCreateLtiTeacher } from '../db/queries/teachers'
import { resolveCourseForLtiLaunch, findLtiCourseLinkId, recordNrpsMembershipsUrl } from '../db/queries/ltiCourseLinks'
import { recordLineItemIfAbsent } from '../db/queries/ltiLineItems'
import {
  createDeepLinkSession, getDeepLinkSession, consumeDeepLinkSession,
} from '../db/queries/ltiDeepLinkSessions'
import {
  listPublishedAssignments, createPublishedAssignment, getPublishedAssignment,
  findOrCreateLtiInvite,
} from '../db/queries/publishedAssignments'

const router = Router()

// ─── GET /api/lti/jwks ─────────────────────────────────────────────────────────
// Public — platforms fetch our tool JWKS to verify service-token assertions
// and Deep Linking response signatures.

router.get('/jwks', asyncHandler(async (_req, res) => {
  const jwks = await toolPublicJwks()
  res.json(jwks)
}))

// ─── GET /api/lti/login ─────────────────────────────────────────────────────────
// OIDC third-party-initiated login. The platform (Moodle) redirects the
// user's browser here first, carrying `iss` + `login_hint` + deployment
// info. We resolve which institution registered this issuer, mint a
// state+nonce, and redirect on to the platform's own auth endpoint — which
// will redirect back to POST /launch with a signed id_token.

router.get('/login', ltiLimiter, asyncHandler(async (req, res) => {
  const iss = typeof req.query.iss === 'string' ? req.query.iss : ''
  const loginHint = typeof req.query.login_hint === 'string' ? req.query.login_hint : ''
  const targetLinkUri = typeof req.query.target_link_uri === 'string' ? req.query.target_link_uri : null
  const ltiMessageHint = typeof req.query.lti_message_hint === 'string' ? req.query.lti_message_hint : undefined
  const clientId = typeof req.query.client_id === 'string' ? req.query.client_id : undefined

  if (!iss || !loginHint) {
    throw new ValidationError('Некорректный запрос запуска LTI (отсутствует iss или login_hint)')
  }

  const disco = await findLtiConfigForIssuer(iss)
  if (!disco || !isLtiConfigComplete(disco)) {
    throw new AppError('LTI не настроен для этой организации', 404, 'LTI_NOT_CONFIGURED')
  }
  if (clientId && disco.lti_platform_client_id && clientId !== disco.lti_platform_client_id) {
    throw new AppError('client_id не совпадает с зарегистрированным', 400, 'LTI_CLIENT_MISMATCH')
  }

  const { state, nonce } = await createLaunchState({
    institutionId: disco.institution_id,
    targetLinkUri,
  })

  const authUrl = new URL(disco.lti_platform_auth_login_url!)
  authUrl.searchParams.set('scope', 'openid')
  authUrl.searchParams.set('response_type', 'id_token')
  authUrl.searchParams.set('response_mode', 'form_post')
  authUrl.searchParams.set('client_id', disco.lti_platform_client_id!)
  authUrl.searchParams.set('redirect_uri', launchCallbackUrl())
  authUrl.searchParams.set('login_hint', loginHint)
  authUrl.searchParams.set('state', state)
  authUrl.searchParams.set('nonce', nonce)
  authUrl.searchParams.set('prompt', 'none')
  if (ltiMessageHint) authUrl.searchParams.set('lti_message_hint', ltiMessageHint)

  res.redirect(authUrl.toString())
}))

// ─── POST /api/lti/launch ────────────────────────────────────────────────────────
// The platform posts the signed id_token here (application/x-www-form-urlencoded,
// same shape as SAML's ACS POST). Branches three ways on message_type/role:
//   - LtiDeepLinkingRequest         → teacher content-item picker (frontend)
//   - LtiResourceLinkRequest, staff → normal grading launch (/lti/callback)
//   - LtiResourceLinkRequest, student → tokenised /student/:token rail

router.post('/launch', ltiLimiter, asyncHandler(async (req, res) => {
  const idToken = (req.body as { id_token?: string }).id_token
  const state = (req.body as { state?: string }).state
  if (!idToken || !state) {
    throw new ValidationError('Отсутствует id_token или state в запросе запуска LTI')
  }

  const consumed = await consumeLaunchState(state)
  if (!consumed) {
    throw new AppError('Запуск LTI просрочен или уже был использован', 400, 'LTI_STATE_INVALID')
  }

  const cfg = await getLtiConfig(consumed.institutionId)
  if (!cfg || !isLtiConfigComplete(cfg)) {
    throw new AppError('LTI не настроен для этой организации', 404, 'LTI_NOT_CONFIGURED')
  }

  const claims = await validateLaunchToken({
    idToken,
    institutionId: consumed.institutionId,
    cfg,
    expectedNonce: consumed.nonce,
  })

  const frontend = process.env.FRONTEND_URL ?? 'http://localhost:5173'

  // ─── Deep Linking: teacher picks/creates a published assignment ────────────
  if (claims.messageType === 'LtiDeepLinkingRequest') {
    if (!isInstructorRole(claims.roles)) {
      throw new AppError('Настройка заданий доступна только преподавателям', 403, 'LTI_DEEP_LINK_FORBIDDEN')
    }
    if (!claims.deepLinkingSettings) {
      throw new AppError('В запросе отсутствуют настройки Deep Linking', 400, 'LTI_NO_DEEP_LINK_SETTINGS')
    }
    if (!claims.email) {
      throw new AppError(
        'В запуске LTI не найден адрес эл. почты. Проверьте настройки конфиденциальности инструмента в Moodle.',
        400, 'LTI_NO_EMAIL'
      )
    }

    const teacher = await findOrCreateLtiTeacher({
      email:         claims.email,
      name:          claims.name,
      institutionId: consumed.institutionId,
      ltiSubject:    claims.sub,
    })
    if (!teacher.is_active) throw new AppError('Аккаунт деактивирован', 403, 'ACCOUNT_DISABLED')

    // Resolve/create the course now (not just at student-launch time) so a
    // published assignment created from this picker is course-scoped from
    // the start — otherwise its grades would never feed course-scoped RAG.
    const courseId = claims.contextId
      ? await resolveCourseForLtiLaunch({
          institutionId: consumed.institutionId,
          deploymentId:  claims.deploymentId,
          contextId:     claims.contextId,
          contextTitle:  claims.contextTitle,
          contextLabel:  claims.contextLabel,
          teacherId:     teacher.id,
        })
      : null

    const sessionId = await createDeepLinkSession({
      institutionId:     consumed.institutionId,
      teacherId:         teacher.id,
      deploymentId:      claims.deploymentId,
      contextId:         claims.contextId,
      contextTitle:      claims.contextTitle,
      courseId,
      deepLinkReturnUrl: claims.deepLinkingSettings.deepLinkReturnUrl,
      passthroughData:   claims.deepLinkingSettings.data,
    })

    const token = signToken({ id: teacher.id, email: teacher.email })
    const pickerUrl = new URL('/lti/deep-link', frontend)
    pickerUrl.searchParams.set('token', token)
    pickerUrl.searchParams.set('session', sessionId)
    res.redirect(pickerUrl.toString())
    return
  }

  // ─── Resource Link launch ────────────────────────────────────────────────────
  if (!claims.contextId) {
    throw new AppError('В запуске LTI отсутствует идентификатор курса (context)', 400, 'LTI_NO_CONTEXT')
  }

  if (isInstructorRole(claims.roles)) {
    if (!claims.email) {
      logger.warn({
        message: 'LTI launch missing email claim',
        institutionId: consumed.institutionId,
        deploymentId: claims.deploymentId,
      })
      throw new AppError(
        'В запуске LTI не найден адрес эл. почты. Проверьте настройки конфиденциальности инструмента в Moodle (разрешите передачу email).',
        400, 'LTI_NO_EMAIL'
      )
    }

    const teacher = await findOrCreateLtiTeacher({
      email:         claims.email,
      name:          claims.name,
      institutionId: consumed.institutionId,
      ltiSubject:    claims.sub,
    })
    if (!teacher.is_active) throw new AppError('Аккаунт деактивирован', 403, 'ACCOUNT_DISABLED')

    const courseId = await resolveCourseForLtiLaunch({
      institutionId: consumed.institutionId,
      deploymentId:  claims.deploymentId,
      contextId:     claims.contextId,
      contextTitle:  claims.contextTitle,
      contextLabel:  claims.contextLabel,
      teacherId:     teacher.id,
    })

    // Best-effort — never blocks the launch if it fails.
    if (claims.nrpsContextMembershipsUrl) {
      recordNrpsMembershipsUrl(
        consumed.institutionId, claims.deploymentId, claims.contextId, claims.nrpsContextMembershipsUrl
      ).catch(err => logger.warn({
        message: 'Failed to record LTI NRPS memberships URL',
        error: err instanceof Error ? err.message : String(err),
      }))
    }

    const token = signToken({ id: teacher.id, email: teacher.email })
    const callbackUrl = new URL('/lti/callback', frontend)
    callbackUrl.searchParams.set('token', token)
    callbackUrl.searchParams.set('courseId', courseId)
    res.redirect(callbackUrl.toString())
    return
  }

  if (isLearnerRole(claims.roles)) {
    const publishedAssignmentId = claims.customParams.published_assignment_id
    if (!publishedAssignmentId) {
      throw new AppError(
        'Этот элемент курса не настроен для сдачи работ через ИСПУМ', 400, 'LTI_NO_PUBLISHED_ASSIGNMENT'
      )
    }

    // Best-effort AGS lineitem capture for the (later) grade write-back
    // milestone — never blocks the student from reaching the writing surface.
    if (claims.agsEndpoint?.lineitem) {
      try {
        const linkId = await findLtiCourseLinkId(consumed.institutionId, claims.deploymentId, claims.contextId)
        if (linkId) {
          await recordLineItemIfAbsent({
            ltiCourseLinkId:       linkId,
            lineitemUrl:           claims.agsEndpoint.lineitem,
            publishedAssignmentId,
          })
        }
      } catch (err) {
        logger.warn({ message: 'Failed to record LTI AGS lineitem', error: err instanceof Error ? err.message : String(err) })
      }
    }

    const invite = await findOrCreateLtiInvite({
      publishedAssignmentId,
      ltiSubject:      claims.sub,
      ltiDeploymentId: claims.deploymentId,
      ltiContextId:    claims.contextId,
      studentName:     claims.name,
      studentEmail:    claims.email,
    })

    res.redirect(new URL(`/student/${invite.token}`, frontend).toString())
    return
  }

  throw new AppError('Роль пользователя LTI не поддерживается', 403, 'LTI_ROLE_UNSUPPORTED')
}))

// ─── Deep Linking picker (frontend-facing, authenticated) ─────────────────────
// Reached via the /lti/deep-link frontend page after the teacher's browser is
// redirected there from POST /launch above.

router.get('/deep-link/:sessionId', authenticate, asyncHandler(async (req, res) => {
  const session = await getDeepLinkSession(req.params.sessionId, req.teacher.id)
  if (!session) throw new AppError('Сессия настройки истекла — откройте задание в Moodle заново', 404, 'LTI_DL_SESSION_EXPIRED')

  const assignments = await listPublishedAssignments(req.teacher.id)
  res.json({
    contextTitle: session.context_title,
    publishedAssignments: assignments.map((a) => ({ id: a.id, title: a.title, status: a.status })),
  })
}))

router.post('/deep-link/:sessionId/select', authenticate, asyncHandler(async (req, res) => {
  const session = await getDeepLinkSession(req.params.sessionId, req.teacher.id)
  if (!session) throw new AppError('Сессия настройки истекла — откройте задание в Moodle заново', 404, 'LTI_DL_SESSION_EXPIRED')

  const body = req.body as { publishedAssignmentId?: string; newTitle?: string }
  let publishedAssignmentId = body.publishedAssignmentId
  let title: string

  if (publishedAssignmentId) {
    const existing = await getPublishedAssignment(publishedAssignmentId, req.teacher.id)
    if (!existing) throw new NotFoundError('Задание')
    title = existing.title
  } else if (body.newTitle?.trim()) {
    const created = await createPublishedAssignment({
      teacherId: req.teacher.id,
      courseId:  session.course_id,
      title:     body.newTitle.trim(),
    })
    publishedAssignmentId = created.id
    title = created.title
  } else {
    throw new ValidationError('Выберите задание или укажите название нового')
  }

  const cfg = await getLtiConfig(session.institution_id)
  if (!cfg || !isLtiConfigComplete(cfg)) {
    throw new AppError('LTI не настроен для этой организации', 404, 'LTI_NOT_CONFIGURED')
  }

  const contentItem: DeepLinkContentItem = {
    type:  'ltiResourceLink',
    url:   launchCallbackUrl(),
    title,
    custom: { published_assignment_id: publishedAssignmentId },
    // Requests the platform auto-provision an AGS gradebook column scoped to
    // this specific resource link — enables the later grade write-back
    // milestone without any extra admin setup.
    lineItem: { scoreMaximum: 100, label: title },
  }

  const jwt = await mintDeepLinkingResponse({
    cfg,
    deploymentId: session.deployment_id,
    data:         session.passthrough_data,
    contentItems: [contentItem],
  })

  await consumeDeepLinkSession(session.id, req.teacher.id)

  res.json({ deepLinkReturnUrl: session.deep_link_return_url, jwt })
}))

// ─── GET /api/lti/register ──────────────────────────────────────────────────────
// IMS Dynamic Registration handshake. Not a JSON API — this renders inside
// the popup/iframe Moodle's own "Dynamic registration" admin screen opens,
// so the response is a small self-contained HTML page, not a redirect back
// into our SPA. The admin gets this URL (with ?session=... already attached)
// from Settings → Organisation → LTI and pastes the whole thing into Moodle;
// Moodle appends its own openid_configuration + registration_token params.

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function registrationResultHtml(ok: boolean, message: string): string {
  return `<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8">
<title>Регистрация LTI</title></head>
<body style="font-family: system-ui, sans-serif; padding: 2rem; text-align: center;">
  <h1>${ok ? 'Регистрация выполнена' : 'Регистрация не удалась'}</h1>
  <p>${escapeHtml(message)}</p>
  <p style="color: #888; font-size: 0.875rem;">Можно закрыть это окно.</p>
</body></html>`
}

router.get('/register', asyncHandler(async (req, res) => {
  const session = typeof req.query.session === 'string' ? req.query.session : ''
  const openidConfiguration = typeof req.query.openid_configuration === 'string' ? req.query.openid_configuration : ''
  const registrationToken = typeof req.query.registration_token === 'string' ? req.query.registration_token : undefined

  if (!session || !openidConfiguration) {
    res.status(400).type('html').send(registrationResultHtml(false, 'Некорректный запрос регистрации LTI.'))
    return
  }

  const institutionId = await consumeRegistrationSession(session)
  if (!institutionId) {
    res.status(400).type('html').send(registrationResultHtml(false, 'Сессия регистрации истекла. Начните заново из настроек ИСПУМ.'))
    return
  }

  try {
    const discovery = await fetchPlatformOpenIdConfiguration(openidConfiguration)
    const { clientId, deploymentId } = await registerWithPlatform(discovery, registrationToken)

    const existing = await getLtiConfig(institutionId)
    const deploymentIds = Array.from(new Set(
      [...(existing?.lti_platform_deployment_ids ?? []), deploymentId].filter((d): d is string => Boolean(d))
    ))

    await setLtiConfig(institutionId, {
      lti_enabled: true,
      lti_platform_issuer: discovery.issuer,
      lti_platform_client_id: clientId,
      lti_platform_auth_login_url: discovery.authorization_endpoint,
      lti_platform_auth_token_url: discovery.token_endpoint,
      lti_platform_jwks_url: discovery.jwks_uri,
      lti_platform_deployment_ids: deploymentIds,
    })

    res.type('html').send(registrationResultHtml(true, 'ИСПУМ успешно зарегистрирован как внешний инструмент.'))
  } catch (err) {
    logger.warn({
      message: 'LTI Dynamic Registration failed',
      institutionId,
      error: err instanceof Error ? err.message : String(err),
    })
    const message = err instanceof AppError ? err.message : 'Не удалось завершить регистрацию.'
    res.status(502).type('html').send(registrationResultHtml(false, message))
  }
}))

export default router
