/**
 * SAML 2.0 service module — single owner of @node-saml/node-saml.
 *
 * ИСПУМ acts as a Service Provider for every institutional IdP (ADFS,
 * Keycloak, Azure AD, ALD Pro). One global SP keypair is used across all
 * institutions (SAML doesn't use chain-of-trust — IdPs pin our cert
 * fingerprint directly from the metadata XML we publish).
 *
 * Per-institution IdP details (entity id, SSO URL, cert, attribute names)
 * live in institutions.saml_*; this module builds a node-saml instance per
 * institution on demand. No instances are cached — the config can change
 * mid-session if an admin edits it, and a fresh build is cheap.
 */
import { SAML, type SamlConfig as NodeSamlConfig } from '@node-saml/node-saml'
import type { SamlConfigRow } from '../db/queries/institutions'
import { AppError } from '../errors/AppError'

// ─── SP identity from env ─────────────────────────────────────────────────────

function spEntityId(): string {
  const id = process.env.SAML_SP_ENTITY_ID
  if (!id) throw new Error('SAML_SP_ENTITY_ID is not set')
  return id
}

function spPrivateKey(): string {
  const k = process.env.SAML_SP_PRIVATE_KEY
  if (!k) throw new Error('SAML_SP_PRIVATE_KEY is not set')
  // Env stores PEM with literal \n — restore to real newlines.
  return k.replace(/\\n/g, '\n')
}

function spCertificate(): string {
  const c = process.env.SAML_SP_CERTIFICATE
  if (!c) throw new Error('SAML_SP_CERTIFICATE is not set')
  return c.replace(/\\n/g, '\n')
}

function backendBaseUrl(): string {
  // The IdP posts the SAMLResponse here, so it must be the *public* backend
  // URL, not the frontend URL. In production both are served from the same
  // origin behind nginx; in dev they differ.
  return process.env.BACKEND_URL ?? process.env.FRONTEND_URL ?? 'http://localhost:3000'
}

// ─── ACS / metadata / login URL builders ──────────────────────────────────────

export function acsUrlForInstitution(institutionId: string): string {
  return `${backendBaseUrl()}/api/sso/${institutionId}/acs`
}

export function metadataUrlForInstitution(institutionId: string): string {
  return `${backendBaseUrl()}/api/sso/${institutionId}/metadata`
}

// ─── node-saml instance builder ───────────────────────────────────────────────

export function buildSamlForInstitution(
  institutionId: string,
  cfg: SamlConfigRow
): SAML {
  if (!cfg.saml_idp_entity_id || !cfg.saml_idp_sso_url || !cfg.saml_idp_x509_cert) {
    throw new AppError(
      'Конфигурация SAML не завершена для этой организации',
      500,
      'SAML_CONFIG_INCOMPLETE'
    )
  }

  const opts: NodeSamlConfig = {
    // Our identity ──────────────────────────────────────────────────────
    issuer:                 spEntityId(),
    callbackUrl:            acsUrlForInstitution(institutionId),
    privateKey:             spPrivateKey(),
    decryptionPvk:          spPrivateKey(),
    publicCert:             spCertificate(),

    // IdP identity ──────────────────────────────────────────────────────
    idpIssuer:              cfg.saml_idp_entity_id,
    entryPoint:             cfg.saml_idp_sso_url,
    idpCert:                cfg.saml_idp_x509_cert,

    // Security ──────────────────────────────────────────────────────────
    // Always sign AuthnRequests so the IdP can verify their origin.
    authnRequestBinding:    'HTTP-Redirect',
    signatureAlgorithm:     'sha256',
    digestAlgorithm:        'sha256',
    wantAssertionsSigned:   true,
    wantAuthnResponseSigned: true,
    // Accept email or unspecified — most IdPs default to one or the other
    // and forcing a specific NameID format breaks JIT flows.
    identifierFormat:       'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified',
  }

  return new SAML(opts)
}

// ─── SP metadata XML ──────────────────────────────────────────────────────────

/**
 * Generate the SP metadata XML the IdP admin imports on their side. Per-
 * institution because the ACS URL is institution-scoped.
 */
export function generateSpMetadata(institutionId: string): string {
  // node-saml's generateServiceProviderMetadata signs/encrypts certs by hand;
  // we hand-craft a minimal metadata document instead so we don't need to
  // build a SAML instance just for metadata (the IdP cert may not be set yet
  // when an admin wants to download our metadata first).
  const entityId    = spEntityId()
  const acsUrl      = acsUrlForInstitution(institutionId)
  const certClean   = spCertificate()
    .replace(/-----BEGIN CERTIFICATE-----/g, '')
    .replace(/-----END CERTIFICATE-----/g, '')
    .replace(/\s+/g, '')

  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     xmlns:ds="http://www.w3.org/2000/09/xmldsig#"
                     entityID="${entityId}">
  <md:SPSSODescriptor AuthnRequestsSigned="true"
                      WantAssertionsSigned="true"
                      protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:KeyDescriptor use="signing">
      <ds:KeyInfo>
        <ds:X509Data><ds:X509Certificate>${certClean}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:KeyDescriptor use="encryption">
      <ds:KeyInfo>
        <ds:X509Data><ds:X509Certificate>${certClean}</ds:X509Certificate></ds:X509Data>
      </ds:KeyInfo>
    </md:KeyDescriptor>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified</md:NameIDFormat>
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                 Location="${acsUrl}"
                                 index="1" />
  </md:SPSSODescriptor>
</md:EntityDescriptor>`
}

// ─── Assertion attribute extraction ───────────────────────────────────────────

/**
 * SAML attributes arrive as an opaque object whose keys vary by IdP — the
 * canonical attribute name (e.g. `urn:oid:0.9.2342.19200300.100.1.3`), a
 * friendly name (`mail`, `email`), or both. We let the institution config
 * declare which attribute holds the email and name, then resolve them with
 * a friendly fallback.
 */
export function extractAttribute(
  attributes: Record<string, unknown> | undefined,
  configuredName: string,
  fallbacks: string[]
): string | null {
  if (!attributes) return null

  // Direct lookup first
  const direct = attributes[configuredName]
  if (typeof direct === 'string' && direct.trim()) return direct.trim()
  if (Array.isArray(direct) && typeof direct[0] === 'string') return direct[0].trim()

  // Fallbacks
  for (const key of fallbacks) {
    const v = attributes[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (Array.isArray(v) && typeof v[0] === 'string') return v[0].trim()
  }
  return null
}

export const EMAIL_FALLBACK_ATTRS = [
  'email',
  'mail',
  'emailAddress',
  'urn:oid:0.9.2342.19200300.100.1.3',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress',
]

export const NAME_FALLBACK_ATTRS = [
  'displayName',
  'name',
  'cn',
  'urn:oid:2.16.840.1.113730.3.1.241',
  'http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name',
]
