/**
 * LTI 1.3 service module — single owner of `jose` for LTI. Mirrors
 * services/saml.ts's role for @node-saml: builds/validates per-institution
 * launches, using the institutions.lti_platform_* config (migration 066).
 *
 * Unlike SAML, LTI is asymmetric (RS256) and platform-keys are fetched live
 * from each platform's JWKS URL rather than pinned upfront — `jose`'s
 * createRemoteJWKSet handles fetch + in-memory TTL caching per URL, so we
 * keep one cached remote-set instance per platform (keyed by jwks_url) for
 * the life of the process instead of hitting the network on every launch.
 */
import {
  createRemoteJWKSet, jwtVerify, SignJWT, type JWTVerifyResult,
} from 'jose'
import { randomUUID } from 'node:crypto'
import { pool } from '../db/connection'
import type { LtiConfigRow } from '../db/queries/institutions'
import { AppError } from '../errors/AppError'
import { toolPrivateKey, toolKeyId } from '../lib/ltiJwks'

// ─── Tool (our) identity — URLs the platform is told to call ──────────────────

function backendBaseUrl(): string {
  return process.env.BACKEND_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000'
}

export function loginInitUrl(): string {
  return `${backendBaseUrl()}/api/lti/login`
}

export function launchCallbackUrl(): string {
  return `${backendBaseUrl()}/api/lti/launch`
}

export function jwksUrl(): string {
  return `${backendBaseUrl()}/api/lti/jwks`
}

// ─── Per-platform remote JWKS cache ────────────────────────────────────────────

const remoteJwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>()

function getRemoteJwks(url: string): ReturnType<typeof createRemoteJWKSet> {
  let cached = remoteJwksCache.get(url)
  if (!cached) {
    cached = createRemoteJWKSet(new URL(url), {
      // Refetch at most once per 10 minutes even on cache-miss kid lookups —
      // bounds worst-case load on a misbehaving/rotating platform.
      cooldownDuration: 600_000,
    })
    remoteJwksCache.set(url, cached)
  }
  return cached
}

// ─── OIDC login-init state/nonce store (single-use, short-lived) ──────────────

const STATE_TTL_MS = 10 * 60 * 1000

export async function createLaunchState(params: {
  institutionId: string
  targetLinkUri: string | null
}): Promise<{ state: string; nonce: string }> {
  const state = randomUUID()
  const nonce = randomUUID()
  await pool.query(
    `INSERT INTO lti_launch_states (state, nonce, institution_id, target_link_uri)
     VALUES ($1, $2, $3, $4)`,
    [state, nonce, params.institutionId, params.targetLinkUri]
  )
  // Lazily sweep expired rows on every login-init call rather than running a
  // cron — login-init volume is low enough that this is cheap and keeps the
  // table from growing unbounded without new infra.
  await pool.query(
    `DELETE FROM lti_launch_states WHERE created_at < NOW() - INTERVAL '${STATE_TTL_MS / 1000} seconds'`
  )
  return { state, nonce }
}

/** Consumes (deletes) a launch state — single-use, replay-proof. */
export async function consumeLaunchState(state: string): Promise<{
  nonce: string
  institutionId: string
} | null> {
  const { rows } = await pool.query<{ nonce: string; institution_id: string; created_at: string }>(
    `DELETE FROM lti_launch_states WHERE state = $1 RETURNING nonce, institution_id, created_at`,
    [state]
  )
  const row = rows[0]
  if (!row) return null
  if (Date.now() - new Date(row.created_at).getTime() > STATE_TTL_MS) return null
  return { nonce: row.nonce, institutionId: row.institution_id }
}

// ─── IMS Dynamic Registration ───────────────────────────────────────────────────
// A platform-initiated browser flow, not a plain API call: the admin pastes
// a URL (below) into Moodle's own "Dynamic registration" screen, which then
// navigates to it appending its own openid_configuration + registration_token
// query params. There's no institution_id in what Moodle sends us, so this
// short-lived session (created when the admin clicks "get link" in our UI)
// is how we recover which institution is registering.

const REGISTRATION_SESSION_TTL_MS = 15 * 60 * 1000

export async function createRegistrationSession(institutionId: string): Promise<string> {
  const { rows } = await pool.query<{ id: string }>(
    `INSERT INTO lti_registration_sessions (institution_id) VALUES ($1) RETURNING id`,
    [institutionId]
  )
  await pool.query(
    `DELETE FROM lti_registration_sessions WHERE created_at < NOW() - INTERVAL '${REGISTRATION_SESSION_TTL_MS / 1000} seconds'`
  )
  return rows[0].id
}

export function registrationInitUrl(sessionId: string): string {
  return `${backendBaseUrl()}/api/lti/register?session=${sessionId}`
}

export async function consumeRegistrationSession(sessionId: string): Promise<string | null> {
  const { rows } = await pool.query<{ institution_id: string; created_at: string }>(
    `DELETE FROM lti_registration_sessions WHERE id = $1 RETURNING institution_id, created_at`,
    [sessionId]
  )
  const row = rows[0]
  if (!row) return null
  if (Date.now() - new Date(row.created_at).getTime() > REGISTRATION_SESSION_TTL_MS) return null
  return row.institution_id
}

export interface PlatformOpenIdConfiguration {
  issuer:               string
  authorization_endpoint: string
  token_endpoint:       string
  jwks_uri:             string
  registration_endpoint: string
}

const DISCOVERY_FETCH_TIMEOUT_MS = 10_000

/** GETs the platform's OpenID Connect discovery document — the URL Moodle
 *  passes us as `openid_configuration`, not authenticated on our side (the
 *  registration session token gates *who* can trigger this, not *what* URL
 *  they can point it at — bounded with a timeout so a slow/hanging target
 *  can't tie up the request indefinitely). */
export async function fetchPlatformOpenIdConfiguration(url: string): Promise<PlatformOpenIdConfiguration> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), DISCOVERY_FETCH_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, { signal: controller.signal })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new AppError('Платформа не ответила вовремя', 504, 'LTI_DISCOVERY_TIMEOUT')
    }
    throw err
  } finally {
    clearTimeout(timeout)
  }
  if (!response.ok) {
    throw new AppError(`Не удалось получить конфигурацию платформы (${response.status})`, 502, 'LTI_DISCOVERY_FAILED')
  }
  const json = await response.json() as Partial<PlatformOpenIdConfiguration>
  if (!json.issuer || !json.authorization_endpoint || !json.token_endpoint || !json.jwks_uri || !json.registration_endpoint) {
    throw new AppError('Конфигурация платформы неполная', 502, 'LTI_DISCOVERY_INCOMPLETE')
  }
  return json as PlatformOpenIdConfiguration
}

/**
 * Registers this tool with the platform per the IMS Dynamic Registration
 * spec (OIDC Dynamic Client Registration + the LTI tool-configuration
 * extension). Returns the client_id the platform assigned us and the
 * deployment_id it created for this registration.
 */
export async function registerWithPlatform(
  discovery: PlatformOpenIdConfiguration,
  registrationToken: string | undefined
): Promise<{ clientId: string; deploymentId: string | null }> {
  const targetLinkUri = launchCallbackUrl()
  const body = {
    application_type:            'web',
    response_types:               ['id_token'],
    grant_types:                  ['client_credentials', 'implicit'],
    initiate_login_uri:           loginInitUrl(),
    redirect_uris:                [launchCallbackUrl()],
    client_name:                  'ИСПУМ',
    jwks_uri:                     jwksUrl(),
    token_endpoint_auth_method:   'private_key_jwt',
    scope: [
      'https://purl.imsglobal.org/spec/lti-ags/scope/score',
      'https://purl.imsglobal.org/spec/lti-ags/scope/lineitem',
      'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly',
    ].join(' '),
    'https://purl.imsglobal.org/spec/lti-tool-configuration': {
      domain: new URL(targetLinkUri).hostname,
      target_link_uri: targetLinkUri,
      claims: ['iss', 'sub', 'name', 'email'],
      messages: [
        { type: 'LtiResourceLinkRequest' },
        { type: 'LtiDeepLinkingRequest', target_link_uri: targetLinkUri },
      ],
    },
  }

  const response = await fetch(discovery.registration_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(registrationToken ? { Authorization: `Bearer ${registrationToken}` } : {}),
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    throw new AppError(`Платформа отклонила регистрацию (${response.status})`, 502, 'LTI_REGISTRATION_REJECTED')
  }

  const json = await response.json() as {
    client_id?: string
    'https://purl.imsglobal.org/spec/lti-tool-configuration'?: { deployment_id?: string }
  }
  if (!json.client_id) {
    throw new AppError('Платформа не вернула client_id', 502, 'LTI_REGISTRATION_NO_CLIENT_ID')
  }

  return {
    clientId: json.client_id,
    deploymentId: json['https://purl.imsglobal.org/spec/lti-tool-configuration']?.deployment_id ?? null,
  }
}

// ─── Launch claims (subset actually consumed by the tool) ─────────────────────

export interface LtiLaunchClaims {
  sub:            string
  iss:            string
  aud:            string | string[]
  email:          string | null
  name:           string | null
  deploymentId:   string
  contextId:      string | null
  contextTitle:   string | null
  contextLabel:   string | null
  roles:          string[]
  messageType:    string
  targetLinkUri:  string | null
  agsEndpoint:    { lineitem?: string; lineitems?: string; scope: string[] } | null
  nrpsContextMembershipsUrl: string | null
  customParams:   Record<string, string>
  deepLinkingSettings: {
    deepLinkReturnUrl: string
    data:              string | null
  } | null
}

const CLAIM = {
  deploymentId: 'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  context:      'https://purl.imsglobal.org/spec/lti/claim/context',
  roles:        'https://purl.imsglobal.org/spec/lti/claim/roles',
  messageType:  'https://purl.imsglobal.org/spec/lti/claim/message_type',
  targetLink:   'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  ags:          'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  nrps:         'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice',
  custom:       'https://purl.imsglobal.org/spec/lti/claim/custom',
  deepLinkingSettings: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
  deepLinkingContentItems: 'https://purl.imsglobal.org/spec/lti-dl/claim/content_items',
  deepLinkingData:  'https://purl.imsglobal.org/spec/lti-dl/claim/data',
  version:      'https://purl.imsglobal.org/spec/lti/claim/version',
} as const

export const LTI_DEEP_LINKING_REQUEST  = 'LtiDeepLinkingRequest'
export const LTI_RESOURCE_LINK_REQUEST = 'LtiResourceLinkRequest'

/**
 * Validates an id_token posted to /api/lti/launch: signature (via the
 * platform's live JWKS), issuer/audience/nonce, deployment_id membership.
 * Throws AppError with a user-facing (Russian) message on any failure.
 */
export async function validateLaunchToken(params: {
  idToken:       string
  institutionId: string
  cfg:           LtiConfigRow
  expectedNonce: string
}): Promise<LtiLaunchClaims> {
  const { idToken, cfg, expectedNonce } = params
  if (!cfg.lti_platform_issuer || !cfg.lti_platform_client_id || !cfg.lti_platform_jwks_url) {
    throw new AppError('Конфигурация LTI не завершена для этой организации', 500, 'LTI_CONFIG_INCOMPLETE')
  }

  let result: JWTVerifyResult
  try {
    result = await jwtVerify(idToken, getRemoteJwks(cfg.lti_platform_jwks_url), {
      issuer:   cfg.lti_platform_issuer,
      audience: cfg.lti_platform_client_id,
    })
  } catch (err) {
    throw new AppError(
      'Не удалось проверить запуск LTI (недействительная подпись)', 400, 'LTI_VALIDATION_FAILED',
      { error: err instanceof Error ? err.message : String(err) }
    )
  }

  const claims = result.payload as Record<string, unknown>

  if (claims.nonce !== expectedNonce) {
    throw new AppError('Недействительный запуск LTI (nonce не совпадает)', 400, 'LTI_NONCE_MISMATCH')
  }

  const deploymentId = claims[CLAIM.deploymentId]
  if (typeof deploymentId !== 'string' || !cfg.lti_platform_deployment_ids.includes(deploymentId)) {
    throw new AppError('Развёртывание LTI не зарегистрировано для этой организации', 400, 'LTI_DEPLOYMENT_UNKNOWN')
  }

  const context = claims[CLAIM.context] as { id?: string; title?: string; label?: string } | undefined
  const rolesRaw = claims[CLAIM.roles]
  const custom = claims[CLAIM.custom] as Record<string, string> | undefined
  const ags = claims[CLAIM.ags] as { lineitem?: string; lineitems?: string; scope?: string[] } | undefined
  const nrps = claims[CLAIM.nrps] as { context_memberships_url?: string } | undefined
  const dlSettings = claims[CLAIM.deepLinkingSettings] as
    { deep_link_return_url?: string; data?: string } | undefined

  return {
    sub:           String(claims.sub ?? ''),
    iss:           String(claims.iss ?? ''),
    aud:           claims.aud as string | string[],
    email:         typeof claims.email === 'string' ? claims.email : null,
    name:          typeof claims.name === 'string' ? claims.name : null,
    deploymentId,
    contextId:     context?.id ?? null,
    contextTitle:  context?.title ?? null,
    contextLabel:  context?.label ?? null,
    roles:         Array.isArray(rolesRaw) ? rolesRaw.map(String) : [],
    messageType:   String(claims[CLAIM.messageType] ?? ''),
    targetLinkUri: typeof claims[CLAIM.targetLink] === 'string' ? claims[CLAIM.targetLink] as string : null,
    agsEndpoint:   ags ? { lineitem: ags.lineitem, lineitems: ags.lineitems, scope: ags.scope ?? [] } : null,
    nrpsContextMembershipsUrl: nrps?.context_memberships_url ?? null,
    customParams:  custom ?? {},
    deepLinkingSettings: dlSettings?.deep_link_return_url
      ? { deepLinkReturnUrl: dlSettings.deep_link_return_url, data: dlSettings.data ?? null }
      : null,
  }
}

// ─── Deep Linking response (tool → platform) ───────────────────────────────────

export interface DeepLinkContentItem {
  type:  'ltiResourceLink'
  url:   string
  title: string
  custom?: Record<string, string>
  lineItem?: { scoreMaximum: number; label: string }
}

/**
 * Signs the LtiDeepLinkingResponse JWT the teacher's browser POSTs back to
 * the platform's deep_link_return_url. Unlike launch validation (verifying
 * the platform's signature), this is the one place the tool itself signs an
 * outbound JWT — same keypair as service-token assertions (lib/ltiJwks.ts).
 */
export async function mintDeepLinkingResponse(params: {
  cfg:           LtiConfigRow
  deploymentId:  string
  data:          string | null
  contentItems:  DeepLinkContentItem[]
}): Promise<string> {
  const privateKey = await toolPrivateKey()

  return new SignJWT({
    [CLAIM.deploymentId]: params.deploymentId,
    [CLAIM.messageType]:  'LtiDeepLinkingResponse',
    [CLAIM.version]:      '1.3.0',
    [CLAIM.deepLinkingContentItems]: params.contentItems,
    ...(params.data ? { [CLAIM.deepLinkingData]: params.data } : {}),
  })
    .setProtectedHeader({ alg: 'RS256', kid: toolKeyId() })
    .setIssuer(params.cfg.lti_platform_client_id!)
    .setAudience(params.cfg.lti_platform_issuer!)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

export function isInstructorRole(roles: string[]): boolean {
  return roles.some(r => r.endsWith('#Instructor') || r.endsWith('#ContentDeveloper'))
}

export function isLearnerRole(roles: string[]): boolean {
  return roles.some(r => r.endsWith('#Learner'))
}

// ─── Outbound service auth (AGS/NRPS) — client_credentials via JWT-bearer ─────

/**
 * Mints a signed assertion the platform's token endpoint exchanges for an
 * access token (RFC 7523 JWT-bearer client assertion — the mechanism LTI
 * Advantage services use instead of a stored client secret).
 */
export async function mintServiceAssertion(cfg: LtiConfigRow): Promise<string> {
  if (!cfg.lti_platform_auth_token_url || !cfg.lti_platform_client_id) {
    throw new AppError('Конфигурация LTI не поддерживает вызовы сервисов (AGS/NRPS)', 500, 'LTI_SERVICE_CONFIG_INCOMPLETE')
  }
  const privateKey = await toolPrivateKey()
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid: toolKeyId() })
    .setIssuer(cfg.lti_platform_client_id)
    .setSubject(cfg.lti_platform_client_id)
    .setAudience(cfg.lti_platform_auth_token_url)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey)
}

// ─── Access-token exchange (per institution + scope set, cached) ──────────────

interface CachedToken { accessToken: string; expiresAt: number }
const accessTokenCache = new Map<string, CachedToken>()

function tokenCacheKey(institutionId: string, scopes: string[]): string {
  return `${institutionId}::${[...scopes].sort().join(' ')}`
}

/**
 * Exchanges a signed service assertion for a platform access token (RFC 7523
 * client_credentials grant). Cached per (institution, scope set) until shortly
 * before the platform's own expiry — avoids a token-endpoint round trip on
 * every grade approval.
 */
export async function getServiceAccessToken(cfg: LtiConfigRow, scopes: string[]): Promise<string> {
  if (!cfg.lti_platform_auth_token_url) {
    throw new AppError('Конфигурация LTI не поддерживает вызовы сервисов (AGS/NRPS)', 500, 'LTI_SERVICE_CONFIG_INCOMPLETE')
  }

  const key = tokenCacheKey(cfg.lti_platform_auth_token_url, scopes)
  const cached = accessTokenCache.get(key)
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.accessToken

  const assertion = await mintServiceAssertion(cfg)
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    client_assertion: assertion,
    scope: scopes.join(' '),
  })

  let response: Response
  try {
    response = await fetch(cfg.lti_platform_auth_token_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  } catch (err) {
    throw new AppError('Не удалось связаться с сервером токенов платформы LTI', 502, 'LTI_TOKEN_FETCH_FAILED', { error: String(err) })
  }
  if (!response.ok) {
    throw new AppError(`Платформа LTI отклонила запрос токена (${response.status})`, 502, 'LTI_TOKEN_REJECTED')
  }

  const json = await response.json() as { access_token: string; expires_in?: number }
  accessTokenCache.set(key, {
    accessToken: json.access_token,
    expiresAt:   Date.now() + (json.expires_in ?? 3600) * 1000,
  })
  return json.access_token
}
