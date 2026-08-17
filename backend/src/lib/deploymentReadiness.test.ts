import { describe, it, expect, vi, afterEach } from 'vitest'

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }))

vi.mock('axios', () => ({
  default: {
    get: getMock,
    isAxiosError: (err: unknown): boolean => !!err && typeof err === 'object' && 'isAxiosError' in err,
  },
}))

// verifyDeploymentReadiness reads config.deploymentMode, which is computed
// at module-eval time — fresh module instance per case, same pattern as
// config.test.ts, so DEPLOYMENT_MODE changes actually take effect.
async function loadReadiness() {
  vi.resetModules()
  return import('./deploymentReadiness')
}

describe('verifyDeploymentReadiness', () => {
  const original = {
    mode:    process.env.DEPLOYMENT_MODE,
    baseUrl: process.env.DEEPSEEK_BASE_URL,
  }

  afterEach(() => {
    if (original.mode === undefined) delete process.env.DEPLOYMENT_MODE
    else process.env.DEPLOYMENT_MODE = original.mode
    if (original.baseUrl === undefined) delete process.env.DEEPSEEK_BASE_URL
    else process.env.DEEPSEEK_BASE_URL = original.baseUrl
    getMock.mockReset()
  })

  it('no-ops for saas — never touches the network', async () => {
    process.env.DEPLOYMENT_MODE = 'saas'
    delete process.env.DEEPSEEK_BASE_URL
    const { verifyDeploymentReadiness } = await loadReadiness()
    await expect(verifyDeploymentReadiness()).resolves.toBeUndefined()
    expect(getMock).not.toHaveBeenCalled()
  })

  it('no-ops for dedicated — never touches the network', async () => {
    process.env.DEPLOYMENT_MODE = 'dedicated'
    const { verifyDeploymentReadiness } = await loadReadiness()
    await expect(verifyDeploymentReadiness()).resolves.toBeUndefined()
    expect(getMock).not.toHaveBeenCalled()
  })

  it('onprem + no DEEPSEEK_BASE_URL override throws before any network call', async () => {
    process.env.DEPLOYMENT_MODE = 'onprem'
    delete process.env.DEEPSEEK_BASE_URL
    const { verifyDeploymentReadiness } = await loadReadiness()
    await expect(verifyDeploymentReadiness()).rejects.toThrow(/DEEPSEEK_BASE_URL is unset/)
    expect(getMock).not.toHaveBeenCalled()
  })

  it('onprem + local endpoint reachable and responding — resolves', async () => {
    process.env.DEPLOYMENT_MODE = 'onprem'
    process.env.DEEPSEEK_BASE_URL = 'http://vllm.internal:8000'
    getMock.mockResolvedValueOnce({ data: { data: [{ id: 'local-model' }] } })
    const { verifyDeploymentReadiness } = await loadReadiness()
    await expect(verifyDeploymentReadiness()).resolves.toBeUndefined()
    expect(getMock).toHaveBeenCalledWith(
      'http://vllm.internal:8000/models',
      expect.objectContaining({ timeout: expect.any(Number) })
    )
  })

  it('onprem + endpoint unreachable — throws with the base URL and cause in the message', async () => {
    process.env.DEPLOYMENT_MODE = 'onprem'
    process.env.DEEPSEEK_BASE_URL = 'http://vllm.internal:8000'
    getMock.mockRejectedValueOnce({ isAxiosError: true, code: 'ECONNREFUSED', message: 'connect ECONNREFUSED' })
    const { verifyDeploymentReadiness } = await loadReadiness()
    await expect(verifyDeploymentReadiness()).rejects.toThrow(/vllm\.internal:8000.*ECONNREFUSED/)
  })

  it('onprem + endpoint responds but not with a model list — throws', async () => {
    process.env.DEPLOYMENT_MODE = 'onprem'
    process.env.DEEPSEEK_BASE_URL = 'http://vllm.internal:8000'
    getMock.mockResolvedValueOnce({ data: { status: 'ok' } })
    const { verifyDeploymentReadiness } = await loadReadiness()
    await expect(verifyDeploymentReadiness()).rejects.toThrow(/recognisable model list/)
  })
})
