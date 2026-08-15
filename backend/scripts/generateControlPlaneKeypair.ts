#!/usr/bin/env node
/**
 * Keypair generator for a control-plane deployment identity
 * (docs/on-prem-deployment.md §16 Track 1.6, §5).
 *
 * Unlike LTI's single global tool keypair (generateLtiToolKeypair.ts), EVERY
 * deployment gets its OWN keypair — the private key stays in that
 * deployment's own environment and signs its telemetry envelopes; the
 * public key is stored on that deployment's `deployments.public_key` row so
 * the control plane can verify who actually sent an envelope. One
 * deployment's key can never forge another's telemetry.
 *
 *   Run: npx tsx backend/scripts/generateControlPlaneKeypair.ts
 *
 * Prints an .env-ready CONTROL_PLANE_PRIVATE_KEY for the deployment's own
 * backend, and the SPKI public key PEM to store on that deployment's row —
 * for the seed 'ispum-cloud' row, that means:
 *   UPDATE deployments SET public_key = '<pasted PEM>'
 *     WHERE id = '00000000-0000-0000-0000-000000000001';
 */
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose'

async function main() {
  const { privateKey, publicKey } = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true })
  const privatePem = await exportPKCS8(privateKey)
  const publicPem  = await exportSPKI(publicKey)

  process.stdout.write('# ── Paste into the DEPLOYMENT\'s own backend .env ─────\n\n')
  process.stdout.write(`CONTROL_PLANE_PRIVATE_KEY="${privatePem.replace(/\r?\n/g, '\\n')}"\n\n`)
  process.stdout.write('# ── Store on that deployment\'s `deployments.public_key` row ──\n\n')
  process.stdout.write(publicPem)
  process.stdout.write('\n# Re-run this script to rotate. Rotating a deployment\'s key means updating\n')
  process.stdout.write('# BOTH sides together — its own env AND its deployments.public_key row — or\n')
  process.stdout.write('# every envelope it sends starts failing verification.\n')
}

main()
