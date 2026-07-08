#!/usr/bin/env node
/**
 * One-off RSA keypair generator for the LTI 1.3 tool identity.
 *
 * ИСПУМ acts as one LTI Tool for every institution's Moodle (or other LMS)
 * platform, signing client_credentials assertions and Deep Linking responses
 * with a single global keypair — mirrors generateSamlSpKeypair.ts, but no
 * self-signed X.509 cert is needed: platforms verify our signature against
 * the JWKS we publish live at GET /api/lti/jwks, matched by `kid`.
 *
 *   Run: npx tsx backend/scripts/generateLtiToolKeypair.ts
 *
 * Prints two .env-ready values: LTI_TOOL_PRIVATE_KEY and LTI_TOOL_KID.
 */
import { generateKeyPair, exportPKCS8 } from 'jose'
import { randomUUID } from 'node:crypto'

async function main() {
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
  const pem = await exportPKCS8(privateKey)
  const kid = randomUUID()

  process.stdout.write('# ── Paste into backend .env ──────────────────────\n\n')
  process.stdout.write(`LTI_TOOL_PRIVATE_KEY="${pem.replace(/\r?\n/g, '\\n')}"\n\n`)
  process.stdout.write(`LTI_TOOL_KID="${kid}"\n`)
  process.stdout.write('\n# Re-run this script to rotate. Rotating invalidates in-flight platform\n')
  process.stdout.write('# service-token caches for a few minutes until they re-fetch our JWKS.\n')
}

main()
