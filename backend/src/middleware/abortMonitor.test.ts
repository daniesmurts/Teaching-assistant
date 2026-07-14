import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import type { Request, Response, NextFunction } from 'express'
import { abortMonitor } from './abortMonitor'

vi.mock('../lib/telegramAlert', () => ({ sendTelegramAlert: vi.fn() }))
vi.mock('../db/queries/incidents', () => ({ recordIncident: vi.fn() }))
vi.mock('../lib/logger', () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

import { sendTelegramAlert } from '../lib/telegramAlert'
import { recordIncident } from '../db/queries/incidents'

// Minimal req/res doubles: res is an EventEmitter so the middleware's
// 'close' listener can be driven directly; writableFinished flips to true
// when the "response" completed before the socket closed.
function makeReqRes(teacherId?: string) {
  const req = {
    originalUrl: '/api/grading/1/email?tone=neutral',
    method: 'POST',
    ...(teacherId ? { teacher: { id: teacherId } } : {}),
  } as unknown as Request
  const res = new EventEmitter() as EventEmitter & { writableFinished: boolean }
  res.writableFinished = false
  const next = vi.fn() as unknown as NextFunction
  return { req, res: res as unknown as Response, emitter: res, next }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.mocked(sendTelegramAlert).mockResolvedValue(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('abortMonitor', () => {
  it('reports an abort on a slow request (close before finish, past threshold)', async () => {
    const { req, res, emitter, next } = makeReqRes('t1')
    abortMonitor(req, res, next)
    expect(next).toHaveBeenCalled()

    vi.advanceTimersByTime(15_000)
    emitter.emit('close')
    await vi.runAllTimersAsync()   // flush the alert → incident promise chain

    expect(sendTelegramAlert).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CLIENT_ABORT',
      path: '/api/grading/1/email',
      method: 'POST',
    }))
    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CLIENT_ABORT',
      teacherId: 't1',
      telegramSent: true,
    }))
  })

  it('stays silent when the response finished normally', async () => {
    const { req, res, emitter, next } = makeReqRes()
    abortMonitor(req, res, next)

    vi.advanceTimersByTime(15_000)
    ;(emitter as unknown as { writableFinished: boolean }).writableFinished = true
    emitter.emit('close')
    await vi.runAllTimersAsync()

    expect(sendTelegramAlert).not.toHaveBeenCalled()
    expect(recordIncident).not.toHaveBeenCalled()
  })

  it('stays silent on a fast abort (user navigating away)', async () => {
    const { req, res, emitter, next } = makeReqRes()
    abortMonitor(req, res, next)

    vi.advanceTimersByTime(2_000)
    emitter.emit('close')
    await vi.runAllTimersAsync()

    expect(sendTelegramAlert).not.toHaveBeenCalled()
    expect(recordIncident).not.toHaveBeenCalled()
  })

  it('still records the incident when the Telegram send rejects', async () => {
    vi.mocked(sendTelegramAlert).mockRejectedValue(new Error('telegram down'))
    const { req, res, emitter, next } = makeReqRes()
    abortMonitor(req, res, next)

    vi.advanceTimersByTime(15_000)
    emitter.emit('close')
    await vi.runAllTimersAsync()

    expect(recordIncident).toHaveBeenCalledWith(expect.objectContaining({
      code: 'CLIENT_ABORT',
      telegramSent: false,
    }))
  })
})
