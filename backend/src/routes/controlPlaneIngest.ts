// Control-plane telemetry ingest — docs/on-prem-deployment.md §5, §16
// Track 1.6. Server-to-server, no JWT: a deployment agent has no teacher
// session, so this authenticates purely via the envelope's own signature —
// same shape as routes/payments.ts's T-Bank webhook (no `authenticate`
// middleware, its own verification inline).
//
// NEVER in the request path of anything user-facing (§5.1's first rule) —
// this route exists so an agent can push data, nothing here is read
// synchronously by any other request.

import { Router } from 'express'
import { asyncHandler } from '../lib/asyncHandler'
import { webhookLimiter } from '../middleware/rateLimits'
import { UnauthorizedError, ValidationError } from '../errors/AppError'
import { logger } from '../lib/logger'
import { decodeDeploymentId, verifyEnvelope } from '../services/controlPlane/signing'
import {
  getDeploymentPublicKey, insertHeartbeat, touchDeployment,
  upsertUsageMonthly, insertIncidents,
} from '../db/queries/controlPlane'

const router = Router()

router.post('/ingest', webhookLimiter, asyncHandler(async (req, res) => {
  const { jws } = req.body as { jws?: string }
  if (!jws || typeof jws !== 'string') {
    throw new ValidationError('Отсутствует подписанная телеметрия (jws)')
  }

  // Unverified peek — ONLY to know which key to check against. Nothing else
  // from the payload is trusted until verifyEnvelope succeeds below.
  let deploymentId: string
  try {
    deploymentId = decodeDeploymentId(jws)
  } catch {
    throw new ValidationError('Некорректный формат телеметрии')
  }

  const publicKey = await getDeploymentPublicKey(deploymentId)
  if (!publicKey) {
    // Deliberately the SAME error for "no such deployment" and "deployment
    // exists but has no key on file" — distinguishing them in the response
    // would let a caller enumerate valid deployment ids.
    logger.warn({ message: 'Control-plane envelope rejected — unknown deployment or no key on file', deploymentId })
    throw new UnauthorizedError('Развёртывание не распознано')
  }

  let verified
  try {
    verified = await verifyEnvelope(jws, publicKey)
  } catch (err) {
    logger.warn({ message: 'Control-plane envelope signature verification failed', deploymentId, error: (err as Error).message })
    throw new UnauthorizedError('Недействительная подпись телеметрии')
  }

  await insertHeartbeat(verified.deploymentId, verified.envelope)
  await touchDeployment(verified.deploymentId, verified.envelope.platform.appVersion)
  if (verified.envelope.usage.length > 0) {
    await upsertUsageMonthly(verified.deploymentId, verified.envelope.usage)
  }
  if (verified.envelope.incidents.length > 0) {
    await insertIncidents(verified.deploymentId, verified.envelope.platform.appVersion, verified.envelope.incidents)
  }

  res.status(201).json({ ok: true })
}))

export default router
