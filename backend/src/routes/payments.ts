import { Router } from 'express'
import crypto from 'crypto'
import { authenticate } from '../middleware/authenticate'
import { asyncHandler } from '../lib/asyncHandler'
import { aiLimiter } from '../middleware/rateLimits'
import { ValidationError, NotFoundError } from '../errors/AppError'
import { logger } from '../lib/logger'
import { config } from '../lib/config'
import { PURCHASABLE_PLANS, isPurchasablePlan } from '../config/pricing'
import {
  initPayment, verifyNotificationToken, buildSubscriptionReceipt,
  getPaymentState, paymentsConfigured,
} from '../services/tbank'
import {
  createPayment, setPaymentId, findPaymentByOrderId, confirmPayment, rejectPayment,
  findPaymentsByTeacher, type PaymentRow,
} from '../db/queries/payments'
import { upgradeTeacherToPro } from '../db/queries/teachers'

const router = Router()

// Confirm a payment + upgrade the teacher — idempotent, shared by the webhook
// and the GetState fallback. Returns true only on the first confirmation.
async function applyConfirmation(payment: PaymentRow, rebillId?: string): Promise<boolean> {
  const firstTime = await confirmPayment(payment.order_id, rebillId)
  if (firstTime) {
    const spec = PURCHASABLE_PLANS[payment.plan as keyof typeof PURCHASABLE_PLANS]
    if (spec) {
      await upgradeTeacherToPro(payment.teacher_id, spec.days, payment.payment_id ?? payment.order_id)
      logger.info({ message: 'Teacher upgraded to Pro', teacherId: payment.teacher_id, plan: payment.plan, orderId: payment.order_id })
    }
  }
  return firstTime
}

// ─── POST /api/payments/create ─ authenticated; returns a T-Bank PaymentURL ───

router.post(
  '/create',
  authenticate,
  aiLimiter,
  asyncHandler(async (req, res) => {
    const { plan } = req.body as { plan?: string }
    if (!plan || !isPurchasablePlan(plan)) {
      throw new ValidationError('Неизвестный тарифный план')
    }

    const spec    = PURCHASABLE_PLANS[plan]
    const orderId = `ga_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`

    await createPayment({
      orderId,
      teacherId:     req.teacher.id,
      plan,
      amountKopecks: spec.amountKopecks,
    })

    const base = config.frontendUrl
    const result = await initPayment({
      orderId,
      amountKopecks:   spec.amountKopecks,
      description:     spec.label,
      notificationURL: `${base}/api/payments/webhook`,
      successURL:      `${base}/payment/result?order=${orderId}`,
      failURL:         `${base}/payment/result?order=${orderId}`,
      customerKey:     req.teacher.id,   // bind card to teacher for future recurring
      receipt:         buildSubscriptionReceipt(req.teacher.email, spec.label, spec.amountKopecks),
    })

    await setPaymentId(orderId, result.paymentId)
    res.json({ paymentUrl: result.paymentURL, orderId })
  })
)

// ─── POST /api/payments/webhook ─ T-Bank server-to-server callback (NO auth) ──
// Verified via the Token signature. Must respond with the body "OK".

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    const body = req.body as Record<string, unknown>

    if (!verifyNotificationToken(body)) {
      logger.warn({ message: 'Payment webhook: invalid token', orderId: body.OrderId })
      res.status(403).send('INVALID TOKEN')
      return
    }

    const orderId = String(body.OrderId ?? '')
    const status  = String(body.Status ?? '')
    const payment = await findPaymentByOrderId(orderId)

    if (!payment) {
      logger.warn({ message: 'Payment webhook: unknown order', orderId })
      res.send('OK') // ack anyway so T-Bank stops retrying
      return
    }

    // CONFIRMED = funds captured (one-stage). Upgrade exactly once.
    if (status === 'CONFIRMED' || status === 'AUTHORIZED') {
      await applyConfirmation(payment, body.RebillId ? String(body.RebillId) : undefined)
    } else if (status === 'REJECTED' || status === 'CANCELED' || status === 'DEADLINE_EXPIRED') {
      await rejectPayment(orderId)
    }

    res.send('OK')
  })
)

// ─── GET /api/payments/status/:orderId ─ frontend polls after redirect back ───

router.get(
  '/status/:orderId',
  authenticate,
  asyncHandler(async (req, res) => {
    let payment = await findPaymentByOrderId(req.params.orderId)
    if (!payment || payment.teacher_id !== req.teacher.id) {
      throw new NotFoundError('Платёж')
    }

    // Active fallback: if still pending, ask T-Bank directly via GetState and
    // settle it here. This makes confirmation work WITHOUT HTTP notifications,
    // so we don't depend on the cabinet's webhook setting at all.
    if (payment.status === 'pending' && payment.payment_id && paymentsConfigured()) {
      try {
        const state = await getPaymentState(payment.payment_id)
        if (state === 'CONFIRMED' || state === 'AUTHORIZED') {
          await applyConfirmation(payment)
        } else if (state === 'REJECTED' || state === 'CANCELED' || state === 'DEADLINE_EXPIRED') {
          await rejectPayment(payment.order_id)
        }
        payment = (await findPaymentByOrderId(req.params.orderId)) ?? payment
      } catch {
        /* non-fatal — return the current stored status */
      }
    }

    res.json({ status: payment.status, plan: payment.plan })
  })
)

// ─── GET /api/payments/history ─ teacher's own payment history ────────────────

router.get(
  '/history',
  authenticate,
  asyncHandler(async (req, res) => {
    const rows = await findPaymentsByTeacher(req.teacher.id)
    res.json(
      rows.map((p) => ({
        order_id:       p.order_id,
        plan:           p.plan,
        amount_kopecks: p.amount_kopecks,
        status:         p.status,
        created_at:     p.created_at,
        confirmed_at:   p.confirmed_at,
      }))
    )
  })
)

export default router
