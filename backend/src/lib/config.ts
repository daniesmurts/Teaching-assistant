import { logger } from './logger'

/** Required — the app cannot run without these. Missing → crash at startup. */
function required(key: string): string {
  const value = process.env[key]
  if (!value) {
    logger.error({ message: `Missing required environment variable: ${key}` })
    throw new Error(`Missing required environment variable: ${key}`)
  }
  return value
}

/** Optional — feature degrades gracefully when absent (logged once at startup). */
function optional(key: string): string | undefined {
  const value = process.env[key]
  return value && value.length > 0 ? value : undefined
}

// docs/on-prem-deployment.md §4/§16 Track 2.1 — one codebase, deployment
// profiles, never a fork. `saas` is the only mode that exists in production
// today (this default), so adding this couldn't change our own cloud's
// behaviour by construction — every mode-specific check below is additive
// and gated on a value nothing sets yet.
const DEPLOYMENT_MODES = ['saas', 'dedicated', 'onprem'] as const
export type DeploymentMode = typeof DEPLOYMENT_MODES[number]

function deploymentMode(): DeploymentMode {
  const raw = process.env.DEPLOYMENT_MODE?.trim() || 'saas'
  if (!(DEPLOYMENT_MODES as readonly string[]).includes(raw)) {
    throw new Error(
      `Invalid DEPLOYMENT_MODE "${raw}" — must be one of: ${DEPLOYMENT_MODES.join(', ')}`
    )
  }
  return raw as DeploymentMode
}

export const config = {
  nodeEnv:       process.env.NODE_ENV ?? 'development',
  isDev:         process.env.NODE_ENV !== 'production',
  deploymentMode: deploymentMode(),
  port:          Number(process.env.PORT) || 3000,
  frontendUrl:   required('FRONTEND_URL'),
  logLevel:      process.env.LOG_LEVEL ?? 'info',

  db:       { url: required('DATABASE_URL') },
  auth:     { jwtSecret: required('JWT_SECRET') },
  deepseek: { apiKey: required('DEEPSEEK_API_KEY') },

  // Optional integrations — local fallbacks exist for dev
  yandex: {
    folderId:         optional('YANDEX_FOLDER_ID'),
    visionApiKey:     optional('YANDEX_VISION_API_KEY'),
    storageBucket:    optional('YANDEX_STORAGE_BUCKET'),
    storageAccessKey: optional('YANDEX_STORAGE_ACCESS_KEY'),
    storageSecretKey: optional('YANDEX_STORAGE_SECRET_KEY'),
    storageEndpoint:  optional('YANDEX_STORAGE_ENDPOINT'),
  },
  email: {
    host: optional('SMTP_HOST'),
    port: Number(process.env.SMTP_PORT) || 465,
    user: optional('SMTP_USER'),
    pass: optional('SMTP_PASS'),
  },
  saml: {
    spEntityId:  optional('SAML_SP_ENTITY_ID'),
    spPrivateKey: optional('SAML_SP_PRIVATE_KEY'),
    spCert:      optional('SAML_SP_CERTIFICATE'),
  },
  lti: {
    toolPrivateKey: optional('LTI_TOOL_PRIVATE_KEY'),
    toolKid:        optional('LTI_TOOL_KID'),
  },
  telegram: {
    botToken: optional('TELEGRAM_BOT_TOKEN'),
    chatId:   optional('TELEGRAM_CHAT_ID'),
  },
  // docs/on-prem-deployment.md §16 Track 1.6 — Phase 1 has our own cloud
  // heartbeat to ITSELF (controlPlaneUrl defaults to localhost), proving the
  // full sign → ingest → store path before any real remote deployment exists.
  // deploymentId defaults to migration 113's seeded 'ispum-cloud' row.
  controlPlane: {
    privateKey:   optional('CONTROL_PLANE_PRIVATE_KEY'),
    deploymentId: process.env.CONTROL_PLANE_DEPLOYMENT_ID ?? '00000000-0000-0000-0000-000000000001',
    url:          process.env.CONTROL_PLANE_URL ?? '',   // resolved against config.port at call time if unset — see agent.ts
  },
} as const

/** Call once at boot. Validates essentials and warns about degraded features. */
export function validateConfig(): void {
  // Touching `config` already ran the required() checks.
  const warnings: string[] = []

  if (!config.yandex.storageAccessKey) warnings.push('object storage (files saved to local ./uploads)')
  if (!config.yandex.visionApiKey)     warnings.push('Yandex Vision OCR (scanned PDFs/images will return empty text)')
  if (!config.email.host)              warnings.push('SMTP email (emails logged to console)')
  if (!config.saml.spPrivateKey || !config.saml.spCert || !config.saml.spEntityId) {
    warnings.push('SAML SSO (institutional SSO logins will be rejected — run scripts/generateSamlSpKeypair.ts)')
  }

  if (!config.lti.toolPrivateKey) {
    warnings.push('LTI 1.3 (LMS launches will be rejected — run scripts/generateLtiToolKeypair.ts)')
  }

  if (!config.telegram.botToken || !config.telegram.chatId) {
    warnings.push('Telegram incident alerts (production errors will only be logged, not pushed)')
  }

  if (!config.controlPlane.privateKey) {
    warnings.push('Control-plane telemetry (heartbeats will not be sent — run scripts/generateControlPlaneKeypair.ts)')
  }

  if (warnings.length > 0 && config.nodeEnv === 'production') {
    logger.warn({ message: 'Running in production with degraded features', degraded: warnings })
  }
}
