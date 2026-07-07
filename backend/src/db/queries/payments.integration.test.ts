import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { pool } from '../connection'
import { createPayment, confirmPayment, rejectPayment, findPaymentByOrderId } from './payments'
import { createTestTeacher } from '../__tests__/fixtures'

beforeEach(async () => { await pool.query('BEGIN') })
afterEach(async () => { await pool.query('ROLLBACK') })

describe('confirmPayment idempotency', () => {
  it('returns true and confirms on the first call', async () => {
    const teacher = await createTestTeacher()
    const payment = await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99900 })

    const confirmed = await confirmPayment(payment.order_id, 'rebill-1')
    expect(confirmed).toBe(true)

    const row = await findPaymentByOrderId(payment.order_id)
    expect(row?.status).toBe('confirmed')
    expect(row?.confirmed_at).not.toBeNull()
    expect(row?.rebill_id).toBe('rebill-1')
  })

  it('returns false and leaves confirmed_at unchanged on a second call — the exact bug class a payment system cannot afford', async () => {
    const teacher = await createTestTeacher()
    const payment = await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99900 })

    await confirmPayment(payment.order_id)
    const firstConfirmedAt = (await findPaymentByOrderId(payment.order_id))?.confirmed_at

    const secondConfirm = await confirmPayment(payment.order_id, 'rebill-should-not-apply')
    expect(secondConfirm).toBe(false)

    const row = await findPaymentByOrderId(payment.order_id)
    expect(row?.confirmed_at?.getTime()).toBe(firstConfirmedAt?.getTime())
    // rebill_id from the (ignored) second call must not overwrite the real one
    expect(row?.rebill_id).toBeNull()
  })
})

describe('rejectPayment', () => {
  it('rejects a pending payment', async () => {
    const teacher = await createTestTeacher()
    const payment = await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99900 })
    await rejectPayment(payment.order_id)
    const row = await findPaymentByOrderId(payment.order_id)
    expect(row?.status).toBe('rejected')
  })

  it('is idempotent — does not reject an already-confirmed payment', async () => {
    const teacher = await createTestTeacher()
    const payment = await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99900 })
    await confirmPayment(payment.order_id)
    await rejectPayment(payment.order_id)
    const row = await findPaymentByOrderId(payment.order_id)
    expect(row?.status).toBe('confirmed')
  })
})
