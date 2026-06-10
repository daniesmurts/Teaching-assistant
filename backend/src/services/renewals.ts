import crypto from 'crypto'
import { logger } from '../lib/logger'
import { paymentsConfigured, chargeRecurrent, buildSubscriptionReceipt, getPaymentState } from './tbank'
import { PURCHASABLE_PLANS } from '../config/pricing'
import {
  findTeachersDueForRenewal, applyRenewalSuccess, enterRenewalGrace,
  endSubscriptionAfterGrace, markRenewalAttempted, type RenewalCandidate,
} from '../db/queries/teachers'
import {
  createPayment, setPaymentId, confirmPayment, rejectPayment, findStalePendingPayments,
} from '../db/queries/payments'
import { fulfillPayment } from './paymentFulfillment'
import { sendEmail } from './emailTransport'
import { renewalFailedEmail, subscriptionEndedEmail } from '../lib/emailTemplates'

const GRACE_DAYS = 3

/** Charge one teacher's saved card for the next period. */
async function renewOne(t: RenewalCandidate): Promise<void> {
  const spec = PURCHASABLE_PLANS[t.subscription_plan as keyof typeof PURCHASABLE_PLANS]
  if (!spec) return

  const graceDeadline = t.renewal_failed_at
    ? new Date(t.renewal_failed_at.getTime() + GRACE_DAYS * 86_400_000)
    : null

  // Grace already exhausted and still failing → end the subscription.
  if (graceDeadline && Date.now() >= graceDeadline.getTime()) {
    await endSubscriptionAfterGrace(t.id)
    sendEmail({ ...subscriptionEndedEmail(t.name ?? t.email), to: t.email })
    logger.info({ message: 'Subscription ended after grace', teacherId: t.id })
    return
  }

  // Stamp the attempt up front — drives the 20h throttle so PM2 restarts
  // can't trigger repeat charges within a day.
  await markRenewalAttempted(t.id)

  const orderId = `rb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`
  await createPayment({ orderId, teacherId: t.id, plan: t.subscription_plan, amountKopecks: spec.amountKopecks })

  let result: { status: string; success: boolean; paymentId: string }
  try {
    result = await chargeRecurrent({
      orderId,
      amountKopecks: spec.amountKopecks,
      description:   spec.label,
      customerKey:   t.id,
      rebillId:      t.rebill_id,
      receipt:       buildSubscriptionReceipt(t.email, spec.label, spec.amountKopecks),
    })
  } catch (err) {
    result = { status: 'ERROR', success: false, paymentId: '' }
    logger.warn({ message: 'Recurrent charge threw', teacherId: t.id, error: (err as Error).message })
  }

  if (result.success) {
    if (result.paymentId) await setPaymentId(orderId, result.paymentId)
    await confirmPayment(orderId)
    await applyRenewalSuccess(t.id, spec.days)
    logger.info({ message: 'Subscription renewed', teacherId: t.id, plan: t.subscription_plan })
    return
  }

  // Charge failed — mark this renewal payment rejected so history stays clean
  await rejectPayment(orderId)

  if (!t.renewal_failed_at) {
    // First failure → enter grace (access kept until grace deadline) + notify
    await enterRenewalGrace(t.id, GRACE_DAYS)
    const until = new Date(Date.now() + GRACE_DAYS * 86_400_000)
    sendEmail({ ...renewalFailedEmail(t.name ?? t.email, until), to: t.email })
    logger.info({ message: 'Renewal failed — entered grace', teacherId: t.id })
  } else {
    // Subsequent failure during grace → reminder (access already runs to graceDeadline)
    if (graceDeadline) {
      sendEmail({ ...renewalFailedEmail(t.name ?? t.email, graceDeadline), to: t.email })
    }
    logger.info({ message: 'Renewal retry failed (in grace)', teacherId: t.id })
  }
}

/** Run the renewal sweep. Safe to call repeatedly; processes each due teacher once. */
export async function runRenewals(): Promise<void> {
  if (!paymentsConfigured()) return
  try {
    const due = await findTeachersDueForRenewal()
    if (due.length === 0) return
    logger.info({ message: 'Renewal sweep starting', count: due.length })
    for (const t of due) {
      await renewOne(t).catch((err) =>
        logger.error({ message: 'Renewal failed for teacher', teacherId: t.id, error: (err as Error).message })
      )
    }
  } catch (err) {
    logger.error({ message: 'Renewal sweep failed', error: (err as Error).message })
  }
}

/**
 * Reconcile "paid but tab closed" cases. Because the cabinet webhook isn't
 * configured, a user who pays then closes the tab before redirect would be
 * charged without being upgraded. This sweep asks T-Bank GetState for recent
 * pending payments and settles them. Idempotent.
 */
export async function reconcilePendingPayments(): Promise<void> {
  if (!paymentsConfigured()) return
  try {
    const stale = await findStalePendingPayments()
    if (stale.length === 0) return
    logger.info({ message: 'Reconciliation sweep', count: stale.length })
    for (const p of stale) {
      try {
        const state = await getPaymentState(p.payment_id!)
        if (state === 'CONFIRMED' || state === 'AUTHORIZED') {
          await fulfillPayment(p)
          logger.info({ message: 'Reconciled paid-but-pending payment', orderId: p.order_id })
        } else if (state === 'REJECTED' || state === 'CANCELED' || state === 'DEADLINE_EXPIRED') {
          await rejectPayment(p.order_id)
        }
      } catch (err) {
        logger.warn({ message: 'Reconcile check failed', orderId: p.order_id, error: (err as Error).message })
      }
    }
  } catch (err) {
    logger.error({ message: 'Reconciliation sweep failed', error: (err as Error).message })
  }
}

/** Start the schedulers: daily renewals + 5-minute payment reconciliation. */
export function startRenewalScheduler(): void {
  if (!paymentsConfigured()) {
    logger.info({ message: 'Payment schedulers not started — payments not configured' })
    return
  }

  // In PM2 cluster mode every worker would otherwise run the scheduler. Gate
  // to worker 0 only so renewals + reconciliation fire exactly once per VM.
  // (NODE_APP_INSTANCE is set by PM2; unset in dev or fork mode → defaults to '0'.)
  const instanceId = process.env.NODE_APP_INSTANCE ?? '0'
  if (instanceId !== '0') {
    logger.info({ message: 'Payment schedulers skipped on this worker', instanceId })
    return
  }

  const DAY = 24 * 60 * 60 * 1000
  setTimeout(() => { void runRenewals() }, 60_000)     // first renewal run 1 min after boot
  setInterval(() => { void runRenewals() }, DAY)        // then daily

  setInterval(() => { void reconcilePendingPayments() }, 5 * 60 * 1000)  // every 5 min
  logger.info({ message: 'Payment schedulers started (renewals daily, reconciliation 5 min)' })
}
