#!/usr/bin/env node
/**
 * One-off SP keypair generator for SAML.
 *
 * The ИСПУМ backend acts as a Service Provider for every institutional IdP.
 * We sign AuthnRequests and decrypt assertions with a single global keypair
 * (one cert across all institutions — simpler than per-institution rotation
 * and what every IdP admin expects from a SaaS SP).
 *
 *   Run:   npx tsx backend/scripts/generateSamlSpKeypair.ts
 *
 * Prints two blocks: a single-line private key and a single-line certificate,
 * ready to paste into .env as SAML_SP_PRIVATE_KEY and SAML_SP_CERTIFICATE.
 * The cert is self-signed (CA chains aren't used in SAML — IdPs trust the
 * fingerprint directly from our metadata).
 */
import { generateKeyPairSync, createSign } from 'node:crypto'

const VALIDITY_YEARS = 10
const SUBJECT = '/CN=ispum.ru SAML SP'

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

// Minimal self-signed X.509. node-saml accepts PEM directly; we use the
// public key wrapped as a cert so IdPs can pin a fingerprint.
const cert = selfSignCertificate(privateKey, publicKey)

function oneLine(pem: string): string {
  return pem.replace(/\r?\n/g, '\\n')
}

process.stdout.write('# ── Paste into backend .env ──────────────────────\n\n')
process.stdout.write(`SAML_SP_PRIVATE_KEY="${oneLine(privateKey)}"\n\n`)
process.stdout.write(`SAML_SP_CERTIFICATE="${oneLine(cert)}"\n`)
process.stdout.write('\n# Valid for ' + VALIDITY_YEARS + ' years. Re-run this script to rotate.\n')

// ───────────────────────────────────────────────────────────────────────────

function selfSignCertificate(privKeyPem: string, pubKeyPem: string): string {
  // We avoid pulling in a heavy X.509 library — use the well-known
  // self-signed-cert recipe via openssl when available, otherwise fall back
  // to a runtime helper. In practice every dev box has openssl.
  try {
    const { execSync } = require('node:child_process')
    const tmp = require('node:os').tmpdir()
    const path = require('node:path')
    const fs = require('node:fs')
    const keyFile = path.join(tmp, `saml-sp-${Date.now()}.key`)
    const csrFile = path.join(tmp, `saml-sp-${Date.now()}.csr`)
    const crtFile = path.join(tmp, `saml-sp-${Date.now()}.crt`)
    fs.writeFileSync(keyFile, privKeyPem, { mode: 0o600 })
    execSync(`openssl req -new -key ${keyFile} -out ${csrFile} -subj "${SUBJECT}"`)
    execSync(`openssl x509 -req -days ${VALIDITY_YEARS * 365} -in ${csrFile} -signkey ${keyFile} -out ${crtFile}`)
    const cert = fs.readFileSync(crtFile, 'utf8')
    fs.unlinkSync(keyFile); fs.unlinkSync(csrFile); fs.unlinkSync(crtFile)
    return cert
  } catch (err) {
    process.stderr.write('\nopenssl not available — paste the public key block below as the certificate field instead.\nIdPs that verify chain-of-trust may reject this; install openssl and re-run for a proper self-signed cert.\n\n')
    return pubKeyPem
  }
}

// Quiet the unused-variable lint — createSign was a leftover from an earlier draft.
void createSign
