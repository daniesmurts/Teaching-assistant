import axios from 'axios'
import { config } from './config'
import { logger } from './logger'

// docs/on-prem-deployment.md §7.8 / §16 Track 2.1 — "with a university
// sysadmin configuring DEEPSEEK_BASE_URL against their vLLM, we need
// boot-time validation per deployment mode — required vars present,
// endpoints reachable, model responding — failing loudly with an
// actionable message. Otherwise a typo becomes «ИСПУМ не работает» three
// days later instead of a clear startup error."
//
// Deliberately separate from validateConfig() (lib/config.ts): that one
// runs synchronously at module-eval time in app.ts, which supertest also
// imports directly for a plain `app` with no network side effects. This
// check does a real HTTP round-trip, so it's only ever called from
// index.ts's main(), before app.listen() — the one place a slow/failed
// check should block startup rather than silently racing the first request.
const PUBLIC_DEEPSEEK_BASE_URL = 'https://api.deepseek.com'
const REACHABILITY_TIMEOUT_MS = 10_000

export async function verifyDeploymentReadiness(): Promise<void> {
  // No-op for saas/dedicated — this check exists purely for the onprem
  // case where the model endpoint is customer-configured and unverified by
  // us in advance. Zero behaviour change for the existing cloud deployment,
  // which never sets DEPLOYMENT_MODE and defaults to 'saas'.
  if (config.deploymentMode !== 'onprem') return

  const baseUrl = process.env.DEEPSEEK_BASE_URL?.trim() || PUBLIC_DEEPSEEK_BASE_URL

  if (baseUrl === PUBLIC_DEEPSEEK_BASE_URL) {
    throw new Error(
      'DEPLOYMENT_MODE=onprem but DEEPSEEK_BASE_URL is unset, so the model calls ' +
      'would silently go to the public DeepSeek cloud API instead of the local ' +
      'deployment — exactly the cross-border transfer an onprem deployment ' +
      'exists to avoid. Set DEEPSEEK_BASE_URL to the local inference endpoint ' +
      '(e.g. the customer\'s vLLM server) before starting.'
    )
  }

  logger.info({ message: 'onprem: checking model endpoint reachability', baseUrl })
  try {
    const res = await axios.get(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${config.deepseek.apiKey}` },
      timeout: REACHABILITY_TIMEOUT_MS,
    })
    if (!Array.isArray(res.data?.data)) {
      throw new Error('endpoint responded but not with a recognisable model list — check DEEPSEEK_BASE_URL points at an OpenAI-compatible /models endpoint')
    }
  } catch (err) {
    const detail = axios.isAxiosError(err)
      ? (err.response ? `HTTP ${err.response.status}` : (err.code ?? err.message))
      : (err as Error).message
    throw new Error(
      `onprem model endpoint unreachable or not responding at ${baseUrl} (${detail}). ` +
      'Check that the local inference server is running, DEEPSEEK_BASE_URL is ' +
      'correct, and the network path from this host to it is open.'
    )
  }
  logger.info({ message: 'onprem: model endpoint reachable, deployment ready' })
}
