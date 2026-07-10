import { describe, it, expect, vi, beforeEach } from 'vitest'
import axios from 'axios'

// Pure dedup-window logic — no network, no DB. axios is mocked so the test
// never depends on TELEGRAM_BOT_TOKEN/reaching api.telegram.org.
vi.mock('axios')
vi.mock('./config', () => ({
  config: { telegram: { botToken: 'test-token', chatId: 'test-chat' } },
}))

describe('sendTelegramAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(axios.post).mockResolvedValue({ data: {} })
  })

  it('sends the first alert for a given code', async () => {
    const { sendTelegramAlert } = await import('./telegramAlert')
    const sent = await sendTelegramAlert({ code: `CODE_${Date.now()}`, message: 'boom' })
    expect(sent).toBe(true)
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('suppresses a repeat alert for the same code within the dedup window', async () => {
    const { sendTelegramAlert } = await import('./telegramAlert')
    const code = `CODE_REPEAT_${Date.now()}`
    const first = await sendTelegramAlert({ code, message: 'boom' })
    const second = await sendTelegramAlert({ code, message: 'boom again' })
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(axios.post).toHaveBeenCalledTimes(1)
  })

  it('does not suppress alerts for a different code', async () => {
    const { sendTelegramAlert } = await import('./telegramAlert')
    const base = Date.now()
    const a = await sendTelegramAlert({ code: `CODE_A_${base}`, message: 'a' })
    const b = await sendTelegramAlert({ code: `CODE_B_${base}`, message: 'b' })
    expect(a).toBe(true)
    expect(b).toBe(true)
    expect(axios.post).toHaveBeenCalledTimes(2)
  })
})
