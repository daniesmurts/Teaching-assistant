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

describe('admin business metrics', () => {
  it('listAllPayments joins teacher info, flags rb_ renewals, and filters by status', async () => {
    const teacher = await createTestTeacher()
    await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99900 })
    await createPayment({ orderId: `rb_${Date.now()}_${teacher.id.slice(0, 8)}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 99900 })
    await confirmPayment(`order-${teacher.id}`)

    const { listAllPayments } = await import('./payments')
    const all = await listAllPayments({ limit: 200, offset: 0 })
    const mine = all.rows.filter((r) => r.teacher_id === teacher.id)
    expect(mine).toHaveLength(2)
    expect(mine.find((r) => r.order_id.startsWith('rb_'))?.is_renewal).toBe(true)
    expect(mine.find((r) => !r.order_id.startsWith('rb_'))?.is_renewal).toBe(false)
    expect(mine[0].teacher_email).toBe(teacher.email)

    const confirmedOnly = await listAllPayments({ status: 'confirmed', limit: 200, offset: 0 })
    expect(confirmedOnly.rows.filter((r) => r.teacher_id === teacher.id)).toHaveLength(1)
  })

  it('getPaymentsSummary counts confirmed revenue and rejected charges in the window', async () => {
    const { getPaymentsSummary } = await import('./payments')
    const before = await getPaymentsSummary()

    const teacher = await createTestTeacher()
    await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 50000 })
    await confirmPayment(`order-${teacher.id}`)
    await createPayment({ orderId: `rb_fail_${teacher.id.slice(0, 8)}`, teacherId: teacher.id, plan: 'pro_monthly', amountKopecks: 50000 })
    await rejectPayment(`rb_fail_${teacher.id.slice(0, 8)}`)

    const after = await getPaymentsSummary()
    expect(after.revenue_30d_kopecks).toBe(before.revenue_30d_kopecks + 50000)
    expect(after.confirmed_30d).toBe(before.confirmed_30d + 1)
    expect(after.rejected_30d).toBe(before.rejected_30d + 1)
  })

  it('getRevenueByMonth buckets confirmed revenue into the current month', async () => {
    const { getRevenueByMonth } = await import('./payments')
    const before = await getRevenueByMonth(12)
    const currentMonth = new Date().toISOString().slice(0, 7)
    const beforeRow = before.find((m) => m.month === currentMonth)

    const teacher = await createTestTeacher()
    await createPayment({ orderId: `order-${teacher.id}`, teacherId: teacher.id, plan: 'pro_annual', amountKopecks: 100000 })
    await confirmPayment(`order-${teacher.id}`)

    const after = await getRevenueByMonth(12)
    const afterRow = after.find((m) => m.month === currentMonth)
    expect(afterRow?.revenue_kopecks).toBe((beforeRow?.revenue_kopecks ?? 0) + 100000)
  })
})
