import { describe, it, expect, vi, afterEach } from 'vitest'

// Covers docs/on-prem-deployment.md §3.5/§16 Track 2.6: a non-DeepSeek
// provider failure must NOT silently retry on DeepSeek when
// config.deploymentMode === 'onprem' — that silent reroute is exactly the
// undocumented cross-provider data path an on-prem ИБ audit exists to catch.
// saas/dedicated keep the existing silent-fallback behaviour unchanged.

const { yandexChatMock, deepseekChatMock } = vi.hoisted(() => ({
  yandexChatMock:   vi.fn(),
  deepseekChatMock: vi.fn(),
}))

vi.mock('../../lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }))
vi.mock('../spendCap', () => ({ checkSpendCap: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../globalSpendCap', () => ({ checkGlobalSpendCap: vi.fn().mockResolvedValue(undefined) }))
vi.mock('../featureSpendCap', () => ({ checkFeatureSpendCap: vi.fn().mockResolvedValue(undefined) }))

const CAPS = { strictJsonMode: true, reasonerMode: true, maxOutputTokens: 4096 }

vi.mock('./deepseek', () => ({
  DeepSeekProvider: class {
    name = 'deepseek'
    capabilities = CAPS
    chat = deepseekChatMock
    chatJSON = deepseekChatMock
    embed = vi.fn()
  },
}))
vi.mock('./yandex', () => ({
  YandexProvider: class {
    name = 'yandex'
    capabilities = CAPS
    chat = yandexChatMock
    chatJSON = yandexChatMock
    embed = vi.fn()
  },
}))
vi.mock('./qwen', () => ({
  QwenProvider: class {
    name = 'qwen'
    capabilities = CAPS
    chat = vi.fn()
    chatJSON = vi.fn()
    embed = vi.fn()
  },
}))

async function loadRegistry() {
  vi.resetModules()
  return import('./registry')
}

describe('registry fallback policy', () => {
  const originalMode = process.env.DEPLOYMENT_MODE

  afterEach(() => {
    if (originalMode === undefined) delete process.env.DEPLOYMENT_MODE
    else process.env.DEPLOYMENT_MODE = originalMode
    yandexChatMock.mockReset()
    deepseekChatMock.mockReset()
  })

  it('saas: primary provider failure falls back to DeepSeek silently', async () => {
    process.env.DEPLOYMENT_MODE = 'saas'
    process.env.DEFAULT_LLM_PROVIDER = 'yandex'
    yandexChatMock.mockRejectedValueOnce(new Error('yandex down'))
    deepseekChatMock.mockResolvedValueOnce('recovered via deepseek')
    const { chat } = await loadRegistry()
    await expect(chat([{ role: 'user', content: 'hi' }])).resolves.toBe('recovered via deepseek')
    expect(deepseekChatMock).toHaveBeenCalledOnce()
  })

  it('onprem: primary provider failure throws instead of falling back to DeepSeek', async () => {
    process.env.DEPLOYMENT_MODE = 'onprem'
    process.env.DEFAULT_LLM_PROVIDER = 'yandex'
    yandexChatMock.mockRejectedValueOnce(new Error('yandex down'))
    const { chat } = await loadRegistry()
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('yandex down')
    expect(deepseekChatMock).not.toHaveBeenCalled()
  })

  it('onprem: DeepSeek itself failing still throws (no fallback ladder to begin with)', async () => {
    process.env.DEPLOYMENT_MODE = 'onprem'
    process.env.DEFAULT_LLM_PROVIDER = 'deepseek'
    deepseekChatMock.mockRejectedValueOnce(new Error('local model down'))
    const { chat } = await loadRegistry()
    await expect(chat([{ role: 'user', content: 'hi' }])).rejects.toThrow('local model down')
  })

  it('dedicated: keeps the existing silent-fallback behaviour (only onprem is stricter)', async () => {
    process.env.DEPLOYMENT_MODE = 'dedicated'
    process.env.DEFAULT_LLM_PROVIDER = 'yandex'
    yandexChatMock.mockRejectedValueOnce(new Error('yandex down'))
    deepseekChatMock.mockResolvedValueOnce('recovered via deepseek')
    const { chat } = await loadRegistry()
    await expect(chat([{ role: 'user', content: 'hi' }])).resolves.toBe('recovered via deepseek')
  })
})
