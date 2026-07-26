import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Multi-account redundancy (2026-07-24 incident: a single DeepSeek account
// ran out of balance and silently degraded every LLM feature). Covers:
// retryable failures fall through to the next account, non-retryable
// failures fail fast without burning other accounts, a fallback fires a
// Telegram alert, and a genuinely malformed request never gets retried.

const { postMock, createUsageLogMock, sendTelegramAlertMock } = vi.hoisted(() => ({
  postMock:             vi.fn(),
  createUsageLogMock:   vi.fn().mockResolvedValue(undefined),
  sendTelegramAlertMock: vi.fn().mockResolvedValue(true),
}))

vi.mock('axios', () => ({
  default: {
    post: postMock,
    isAxiosError: (err: unknown): boolean => !!err && typeof err === 'object' && 'isAxiosError' in err,
  },
}))
vi.mock('../../db/queries/usageLog', () => ({ createUsageLog: createUsageLogMock }))
vi.mock('../../lib/telegramAlert', () => ({ sendTelegramAlert: sendTelegramAlertMock }))

import { DeepSeekProvider, TruncatedResponseError } from './deepseek'

function axiosError(status: number | undefined) {
  const err: Record<string, unknown> = { isAxiosError: true, message: `status ${status}` }
  if (status !== undefined) err.response = { status }
  return err
}

function okResponse(content = 'ok') {
  return { data: { choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5 } } }
}

function truncatedResponse(content = '{"incomplete') {
  return {
    data: {
      choices: [{ message: { content }, finish_reason: 'length' }],
      usage: { prompt_tokens: 10, completion_tokens: 8192 },
    },
  }
}

const ENV_KEYS = [
  'DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_ACCOUNT_NAME',
  'DEEPSEEK_API_KEY_2', 'DEEPSEEK_BASE_URL_2', 'DEEPSEEK_ACCOUNT_NAME_2',
  'DEEPSEEK_API_KEY_3', 'DEEPSEEK_BASE_URL_3', 'DEEPSEEK_ACCOUNT_NAME_3',
]
const savedEnv: Record<string, string | undefined> = {}

describe('DeepSeekProvider — multi-account fallback', () => {
  let uniqueSuffix = 0

  beforeEach(() => {
    for (const k of ENV_KEYS) { savedEnv[k] = process.env[k]; delete process.env[k] }
    postMock.mockReset()
    createUsageLogMock.mockClear()
    sendTelegramAlertMock.mockClear()
    uniqueSuffix++
  })
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    }
  })

  // Every test uses a fresh account-name suffix so the module-level cooldown
  // map (keyed by account label) never leaks state between tests.
  function setAccounts(n: 1 | 2 | 3) {
    process.env.DEEPSEEK_API_KEY = 'key-primary'
    process.env.DEEPSEEK_ACCOUNT_NAME = `primary-${uniqueSuffix}`
    if (n >= 2) {
      process.env.DEEPSEEK_API_KEY_2 = 'key-2'
      process.env.DEEPSEEK_ACCOUNT_NAME_2 = `secondary-${uniqueSuffix}`
    }
    if (n >= 3) {
      process.env.DEEPSEEK_API_KEY_3 = 'key-3'
      process.env.DEEPSEEK_ACCOUNT_NAME_3 = `tertiary-${uniqueSuffix}`
    }
  }

  it('single account, success — unchanged behavior', async () => {
    setAccounts(1)
    postMock.mockResolvedValueOnce(okResponse('hello'))
    const result = await new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('hello')
    expect(postMock).toHaveBeenCalledOnce()
    expect(sendTelegramAlertMock).not.toHaveBeenCalled()
  })

  it('throws when no DEEPSEEK_API_KEY is configured at all', async () => {
    await expect(new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }]))
      .rejects.toThrow('DEEPSEEK_API_KEY is not set')
  })

  it('falls back to account 2 on a 402 (retryable) and returns its result', async () => {
    setAccounts(2)
    postMock.mockRejectedValueOnce(axiosError(402))
    postMock.mockResolvedValueOnce(okResponse('from account 2'))

    const result = await new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])

    expect(result).toBe('from account 2')
    expect(postMock).toHaveBeenCalledTimes(2)
    // second attempt used account 2's key
    expect(postMock.mock.calls[1][2].headers.Authorization).toBe('Bearer key-2')
  })

  it('fires a Telegram alert when it falls back to a secondary account', async () => {
    setAccounts(2)
    postMock.mockRejectedValueOnce(axiosError(402))
    postMock.mockResolvedValueOnce(okResponse())

    await new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])

    expect(sendTelegramAlertMock).toHaveBeenCalledOnce()
    const alert = sendTelegramAlertMock.mock.calls[0][0]
    expect(alert.code).toBe('DEEPSEEK_ACCOUNT_FALLBACK')
    expect(alert.message).toContain('HTTP 402')
  })

  it('does not retry a non-retryable error (400) — fails fast without trying account 2', async () => {
    setAccounts(2)
    postMock.mockRejectedValueOnce(axiosError(400))

    await expect(new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])).rejects.toBeTruthy()

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(sendTelegramAlertMock).not.toHaveBeenCalled()
  })

  it('throws the last error when every account fails', async () => {
    setAccounts(2)
    postMock.mockRejectedValueOnce(axiosError(402))
    postMock.mockRejectedValueOnce(axiosError(503))

    await expect(new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])).rejects.toBeTruthy()
    expect(postMock).toHaveBeenCalledTimes(2)
  })

  it('retries on a network error with no response at all', async () => {
    setAccounts(2)
    postMock.mockRejectedValueOnce({ isAxiosError: true, message: 'timeout' }) // no .response
    postMock.mockResolvedValueOnce(okResponse('recovered'))

    const result = await new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])
    expect(result).toBe('recovered')
  })

  it('a cooling-down account is tried after healthy ones, not skipped entirely', async () => {
    setAccounts(2)
    // First call: account 1 fails (402, retryable) → cooldown set; account 2 succeeds.
    postMock.mockRejectedValueOnce(axiosError(402))
    postMock.mockResolvedValueOnce(okResponse())
    const provider = new DeepSeekProvider()
    await provider.chat([{ role: 'user', content: 'first' }])
    postMock.mockClear()

    // Second call, immediately after: account 1 is still cooling down, so
    // account 2 (healthy) should be tried FIRST this time.
    postMock.mockResolvedValueOnce(okResponse('account 2 again'))
    await provider.chat([{ role: 'user', content: 'second' }])

    expect(postMock).toHaveBeenCalledTimes(1)
    expect(postMock.mock.calls[0][2].headers.Authorization).toBe('Bearer key-2')
  })

  it('records a failed usage log entry per failed attempt when context is given', async () => {
    setAccounts(2)
    postMock.mockRejectedValueOnce(axiosError(402))
    postMock.mockResolvedValueOnce(okResponse())

    await new DeepSeekProvider().chat(
      [{ role: 'user', content: 'hi' }],
      { context: { teacherId: 't1', feature: 'grading' } }
    )

    expect(createUsageLogMock).toHaveBeenCalledTimes(2)
    expect(createUsageLogMock.mock.calls[0][0]).toMatchObject({ success: false, errorCode: 'HTTP_402' })
    expect(createUsageLogMock.mock.calls[1][0]).toMatchObject({ success: true })
  })

  // TODO.md Improvement #10 — a truncated response used to come back as a
  // normal (successful) `chat()` result, so chatJSON's JSON.parse would fail
  // on the cut-off content and burn a second, identically-doomed call before
  // surfacing an error. Covers: chat() fails fast on truncation, doesn't
  // retry another account, chatJSON doesn't attempt its repair-retry, and
  // exactly one accurately-costed usage log row is written per truncation.
  describe('truncated responses (finish_reason = length)', () => {
    it('chat() throws TruncatedResponseError instead of returning the cut-off content', async () => {
      setAccounts(1)
      postMock.mockResolvedValueOnce(truncatedResponse())

      await expect(new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }]))
        .rejects.toBeInstanceOf(TruncatedResponseError)
    })

    it('does not fall back to another account — a truncation is not an account-level problem', async () => {
      setAccounts(2)
      postMock.mockResolvedValueOnce(truncatedResponse())

      await expect(new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])).rejects.toBeTruthy()

      expect(postMock).toHaveBeenCalledTimes(1)
      expect(sendTelegramAlertMock).not.toHaveBeenCalled()
    })

    it('chatJSON does not attempt its JSON-repair retry on a truncated response', async () => {
      setAccounts(1)
      postMock.mockResolvedValueOnce(truncatedResponse())

      await expect(new DeepSeekProvider().chatJSON([{ role: 'user', content: 'hi' }]))
        .rejects.toBeInstanceOf(TruncatedResponseError)

      // Only the one truncated attempt — no second "please return valid JSON" call.
      expect(postMock).toHaveBeenCalledTimes(1)
    })

    it('writes exactly one usage log row, errorCode TRUNCATED, with the real (non-zero) token counts', async () => {
      setAccounts(1)
      postMock.mockResolvedValueOnce(truncatedResponse())

      await expect(new DeepSeekProvider().chat(
        [{ role: 'user', content: 'hi' }],
        { context: { teacherId: 't1', feature: 'presentation' } }
      )).rejects.toBeInstanceOf(TruncatedResponseError)

      expect(createUsageLogMock).toHaveBeenCalledTimes(1)
      expect(createUsageLogMock.mock.calls[0][0]).toMatchObject({
        success: false, errorCode: 'TRUNCATED', inputTokens: 10, outputTokens: 8192,
      })
    })

    it('a normal (non-truncated) response is unaffected', async () => {
      setAccounts(1)
      postMock.mockResolvedValueOnce(okResponse('hello'))

      const result = await new DeepSeekProvider().chat([{ role: 'user', content: 'hi' }])
      expect(result).toBe('hello')
    })
  })
})
