import { logger } from '../lib/logger'
import { PURCHASABLE_PLANS } from '../config/pricing'
import { getRebillId } from './tbank'
import { confirmPayment, type PaymentRow } from '../db/queries/payments'
import { upgradeTeacherToPro, setRecurringInfo } from '../db/queries/teachers'

/**
 * Confirm a payment + upgrade the teacher, idempotently. Shared by the webhook,
 * the GetState fallback on /payment/result, and the reconciliation sweep.
 * Returns true only on the FIRST confirmation.
 */
export async function fulfillPayment(payment: PaymentRow, rebillId?: string): Promise<boolean> {
  const firstTime = await confirmPayment(payment.order_id, rebillId)
  if (!firstTime) return false

  const spec = PURCHASABLE_PLANS[payment.plan as keyof typeof PURCHASABLE_PLANS]
  if (!spec) return true

  await upgradeTeacherToPro(payment.teacher_id, spec.days, payment.payment_id ?? payment.order_id)
  logger.info({ message: 'Teacher upgraded to Pro', teacherId: payment.teacher_id, plan: payment.plan, orderId: payment.order_id })

  // Register the saved card for auto-renewal (webhook-independent via GetCardList).
  try {
    const token = rebillId ?? (await getRebillId(payment.teacher_id))
    if (token) {
      await setRecurringInfo(payment.teacher_id, token, payment.plan)
      logger.info({ message: 'Auto-renewal enabled', teacherId: payment.teacher_id })
    }
  } catch (err) {
    logger.warn({ message: 'Could not enable auto-renewal', teacherId: payment.teacher_id, error: (err as Error).message })
  }
  return true
}
