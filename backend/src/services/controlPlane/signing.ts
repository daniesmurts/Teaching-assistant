// Envelope signing/verification — docs/on-prem-deployment.md §5.2, §16
// Track 1.6. The envelope IS the JWT payload (same shape as LTI's signed
// launch JWTs, services/lti.ts) rather than a separate
// "envelope + detached signature" scheme — one less thing to invent, and it
// reuses the exact SignJWT/jwtVerify pair already trusted elsewhere in this
// codebase.
//
// `sub` carries the deployment id (standard JWT convention for "who this
// token represents"). Verification is two steps because the verifier
// doesn't know WHICH key to check against until it knows WHO sent the
// envelope: decodeDeploymentId() peeks at `sub` WITHOUT verifying (never
// trust anything from this beyond routing to the right key), the caller
// looks up that deployment's public_key, then verifyEnvelope() does the
// real cryptographic check.

import { SignJWT, jwtVerify, decodeJwt, importPKCS8, importSPKI } from 'jose'
import type { TelemetryEnvelope } from './envelope'

const ALG = 'RS256'

export async function signEnvelope(
  deploymentId:  string,
  envelope:      TelemetryEnvelope,
  privateKeyPem: string,
  agentVersion:  string,
): Promise<string> {
  const key = await importPKCS8(privateKeyPem, ALG)
  return new SignJWT({ ...envelope, agentVersion })
    .setProtectedHeader({ alg: ALG })
    .setSubject(deploymentId)
    .setIssuedAt()
    .sign(key)
}

/**
 * Unverified peek at who claims to have sent this envelope, ONLY to know
 * which deployment's public key to fetch for real verification. Never act
 * on any other field from this — the payload is unauthenticated at this point.
 */
export function decodeDeploymentId(jws: string): string {
  const { sub } = decodeJwt(jws)
  if (!sub) throw new Error('Envelope JWT has no `sub` (deployment id) claim')
  return sub
}

export interface VerifiedEnvelope {
  deploymentId: string
  sentAt:       Date
  agentVersion: string
  envelope:     TelemetryEnvelope
}

export async function verifyEnvelope(jws: string, publicKeyPem: string): Promise<VerifiedEnvelope> {
  const key = await importSPKI(publicKeyPem, ALG)
  const { payload } = await jwtVerify(jws, key, { algorithms: [ALG] })

  const { sub, iat, agentVersion, ...envelope } = payload
  if (!sub) throw new Error('Verified envelope JWT has no `sub` claim')
  if (!iat) throw new Error('Verified envelope JWT has no `iat` claim')
  if (typeof agentVersion !== 'string') throw new Error('Verified envelope JWT has no `agentVersion` claim')

  return {
    deploymentId: sub,
    sentAt:       new Date(iat * 1000),
    agentVersion,
    envelope:     envelope as unknown as TelemetryEnvelope,
  }
}
