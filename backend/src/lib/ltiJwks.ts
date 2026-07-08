/**
 * LTI 1.3 tool identity — single global RSA keypair (like SAML's single SP
 * keypair), used to:
 *  - sign client_credentials JWT-bearer assertions when calling a platform's
 *    AGS/NRPS service endpoints (services/lti.ts mintServiceAssertion)
 *  - sign LtiDeepLinkingResponse JWTs sent back to the platform
 *  - publish our public key at GET /api/lti/jwks so platforms can verify both
 *
 * Unlike SAML, LTI has no chain-of-trust cert requirement — platforms fetch
 * our JWKS live and match by `kid`, so no self-signed X.509 cert is needed,
 * just a PEM private key + a stable key id.
 *
 * Run: npx tsx backend/scripts/generateLtiToolKeypair.ts
 */
import { importPKCS8, exportJWK, type JWK, type KeyLike } from 'jose'

function privateKeyPem(): string {
  const k = process.env.LTI_TOOL_PRIVATE_KEY
  if (!k) throw new Error('LTI_TOOL_PRIVATE_KEY is not set')
  return k.replace(/\\n/g, '\n')
}

function keyId(): string {
  return process.env.LTI_TOOL_KID ?? 'ispum-lti-tool-key-1'
}

let cachedPrivateKey: KeyLike | null = null

export async function toolPrivateKey(): Promise<KeyLike> {
  if (cachedPrivateKey) return cachedPrivateKey
  const key = await importPKCS8(privateKeyPem(), 'RS256')
  cachedPrivateKey = key
  return key
}

export function toolKeyId(): string {
  return keyId()
}

let cachedPublicJwks: { keys: JWK[] } | null = null

/** Public JWKS document published at GET /api/lti/jwks. */
export async function toolPublicJwks(): Promise<{ keys: JWK[] }> {
  if (cachedPublicJwks) return cachedPublicJwks
  const privateKey = await toolPrivateKey()
  const jwk = await exportJWK(privateKey)
  // exportJWK on a private key includes the private components (d, p, q, ...)
  // — strip them so only the public parts (n, e) are published.
  const { d, p, q, dp, dq, qi, ...publicJwk } = jwk
  cachedPublicJwks = {
    keys: [{ ...publicJwk, kid: keyId(), use: 'sig', alg: 'RS256' }],
  }
  return cachedPublicJwks
}
