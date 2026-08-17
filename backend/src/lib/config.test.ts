import { describe, it, expect, afterEach, vi } from 'vitest'

// config.ts computes `deploymentMode` at module-eval time, so each case
// needs a fresh module instance — vi.resetModules() + dynamic import,
// rather than a single static top-level import.
async function loadConfig() {
  vi.resetModules()
  return import('./config')
}

describe('deploymentMode', () => {
  const originalMode = process.env.DEPLOYMENT_MODE

  afterEach(() => {
    if (originalMode === undefined) delete process.env.DEPLOYMENT_MODE
    else process.env.DEPLOYMENT_MODE = originalMode
  })

  it('defaults to saas when unset', async () => {
    delete process.env.DEPLOYMENT_MODE
    const { config } = await loadConfig()
    expect(config.deploymentMode).toBe('saas')
  })

  it.each(['saas', 'dedicated', 'onprem'])('accepts "%s"', async (mode) => {
    process.env.DEPLOYMENT_MODE = mode
    const { config } = await loadConfig()
    expect(config.deploymentMode).toBe(mode)
  })

  it('throws with an actionable message on an invalid value', async () => {
    process.env.DEPLOYMENT_MODE = 'production'
    await expect(loadConfig()).rejects.toThrow(/Invalid DEPLOYMENT_MODE "production".*saas, dedicated, onprem/)
  })
})
