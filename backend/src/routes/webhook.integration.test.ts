// Full HTTP-level test against the real Express route — the one flow in
// this suite that gets true request/response testing, because the exact
// wire format (status code + body string) is a contract with a third
// party (T-Bank), not something we control on both ends.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import request from 'supertest'
import { app } from '../app'
import { pool } from '../db/connection'
import { computeToken } from '../services/tbank'
import { createPayment, findPaymentByOrderId } from '../db/queries/payments'
import { createTestTeacher } from '../db/__tests__/fixtures'

// findTeacherById() returns the public Teacher shape, which deliberately
// omits plan_tier (surfaced separately via buildPlanData) — read the raw
// column directly to verify the webhook's upgrade actually happened.
async function planTierOf(teacherId: string): Promise<string> {
  const { rows } = await pool.query<{ plan_tier: string }>('SELECT plan_tier FROM teachers WHERE id = $1', [teacherId])
  return rows[0].plan_tier
}

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

const TERMINAL_PASSWORD = process.env.TBANK_TERMINAL_PASSWORD!

function signedBody(body: Record<string, unknown>): Record<string, unknown> {
  return { ...body, Token: computeToken(body, TERMINAL_PASSWORD) }
}

describe('POST /api/payments/webhook', () => {
  it('confirms the payment and upgrades the teacher on a valid CONFIRMED notification', async () => {
    const teacher = await createTestTeacher()
    const orderId = `order-${teacher.id}`
    await createPayment({ orderId, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99_000 })

    const body = signedBody({
      TerminalKey: 'test-terminal-key',
      OrderId:     orderId,
      Status:      'CONFIRMED',
      PaymentId:   '123456789',
      Amount:      99_000,
      RebillId:    'test-rebill-id',   // present so fulfillPayment never calls the real getRebillId() fallback
    })

    const res = await request(app).post('/api/payments/webhook').send(body)

    expect(res.status).toBe(200)
    expect(res.text).toBe('OK')

    const payment = await findPaymentByOrderId(orderId)
    expect(payment?.status).toBe('confirmed')

    expect(await planTierOf(teacher.id)).toBe('pro')
  })

  it('rejects a tampered token with 403 and the exact body T-Bank expects', async () => {
    const teacher = await createTestTeacher()
    const orderId = `order-${teacher.id}`
    await createPayment({ orderId, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99_000 })

    const res = await request(app).post('/api/payments/webhook').send({
      TerminalKey: 'test-terminal-key',
      OrderId:     orderId,
      Status:      'CONFIRMED',
      Token:       'not-a-valid-signature',
    })

    expect(res.status).toBe(403)
    expect(res.text).toBe('INVALID TOKEN')

    // Confirm no DB write happened despite the (rejected) confirmation attempt
    const payment = await findPaymentByOrderId(orderId)
    expect(payment?.status).toBe('pending')
  })

  it('acks an unknown OrderId with 200 OK so T-Bank stops retrying, without writing anything', async () => {
    const body = signedBody({
      TerminalKey: 'test-terminal-key',
      OrderId:     'order-that-does-not-exist',
      Status:      'CONFIRMED',
    })

    const res = await request(app).post('/api/payments/webhook').send(body)

    expect(res.status).toBe(200)
    expect(res.text).toBe('OK')
  })

  it('rejects a payment on REJECTED status', async () => {
    const teacher = await createTestTeacher()
    const orderId = `order-${teacher.id}`
    await createPayment({ orderId, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99_000 })

    const body = signedBody({ TerminalKey: 'test-terminal-key', OrderId: orderId, Status: 'REJECTED' })
    const res = await request(app).post('/api/payments/webhook').send(body)

    expect(res.status).toBe(200)
    expect(res.text).toBe('OK')
    const payment = await findPaymentByOrderId(orderId)
    expect(payment?.status).toBe('rejected')
  })
})
