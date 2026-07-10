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

export const config = {
  nodeEnv:     process.env.NODE_ENV ?? 'development',
  isDev:       process.env.NODE_ENV !== 'production',
  port:        Number(process.env.PORT) || 3000,
  frontendUrl: required('FRONTEND_URL'),
  logLevel:    process.env.LOG_LEVEL ?? 'info',

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

  if (warnings.length > 0 && config.nodeEnv === 'production') {
    logger.warn({ message: 'Running in production with degraded features', degraded: warnings })
  }
}
